#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RELEASE=$ROOT/deploy/bin/blog-release
TMP=$(mktemp -d)
cleanup_test_tmp() {
  if test "${KEEP_TEST_TMP:-false}" = true; then
    echo "kept test tmp: $TMP" >&2
  else
    rm -rf "$TMP"
  fi
}
trap cleanup_test_tmp EXIT

fail() {
  echo "not ok - $*" >&2
  exit 1
}

assert_eq() {
  expected=$1
  actual=$2
  message=$3
  test "$actual" = "$expected" || fail "$message (expected '$expected', got '$actual')"
}

assert_file_eq() {
  file=$1
  expected=$2
  message=$3
  test -f "$file" || fail "$message (missing $file)"
  assert_eq "$expected" "$(cat "$file")" "$message"
}

assert_missing() {
  test ! -e "$1" && test ! -L "$1" || fail "$2 ($1 exists)"
}

assert_log() {
  grep -F -- "$1" "$2" >/dev/null || fail "$3"
}

assert_not_log() {
  if grep -F -- "$1" "$2" >/dev/null; then
    fail "$3"
  fi
}

test -x "$RELEASE" || fail "release command is missing or not executable: $RELEASE"
assert_log 'deploy/bin/blog-release text eol=lf' "$ROOT/.gitattributes" 'release command is not pinned to LF for Linux archives'
assert_log 'tests/deploy/blog-release.test.sh text eol=lf' "$ROOT/.gitattributes" 'release test is not pinned to LF for Linux archives'

mkdir -p "$TMP/bin"
export DOCKER_BIN=$TMP/bin/docker
export CURL_BIN=$TMP/bin/curl
export REAL_MV
REAL_MV=$(command -v mv)
export REAL_RM
REAL_RM=$(command -v rm)
export REAL_DATE
REAL_DATE=$(command -v date)
export REAL_LN
REAL_LN=$(command -v ln)
ORIGINAL_PATH=$PATH

cat > "$DOCKER_BIN" <<'SH'
#!/bin/sh
set -eu
printf 'BLOG_IMAGE=%s %s\n' "${BLOG_IMAGE:-}" "$*" >> "$DOCKER_LOG"

image_matches() {
  filter=$1
  if test -z "$filter"; then return 1; fi
  case ${BLOG_IMAGE:-} in
    *"$filter"*) return 0 ;;
    *) return 1 ;;
  esac
}

case ${1:-} in
  pull)
    if test "${FAIL_PULL:-false}" = true; then exit 1; fi
    if test "${ASSERT_OWNED_LOCK:-false}" = true; then
      test -f "$BLOG_STATE_DIR/deploy.lock" || exit 1
      set -- "$BLOG_STATE_DIR"/.deploy.lock-token.*
      test "$#" -eq 1 || exit 1
      test -f "$1" || exit 1
      test "$BLOG_STATE_DIR/deploy.lock" -ef "$1" || exit 1
      test -n "$(cat "$1")" || exit 1
      test "$(cat "$BLOG_STATE_DIR/deploy.lock")" = "$(cat "$1")" || exit 1
      : > "$LOCK_ASSERTED"
    fi
    ;;
  run)
    if test "${FAIL_RUN:-false}" = true; then exit 1; fi
    candidate_name=
    expect_name=false
    for arg in "$@"; do
      if test "$expect_name" = true; then
        candidate_name=$arg
        expect_name=false
      elif test "$arg" = --name; then
        expect_name=true
      fi
    done
    test -n "$candidate_name" || exit 1
    printf '%s\n' "$candidate_name" > "$CANDIDATE_STATE"
    printf 'candidate-id\n'
    ;;
  rm)
    candidate_name=
    for arg in "$@"; do candidate_name=$arg; done
    if test -f "$CANDIDATE_STATE" && test "$(cat "$CANDIDATE_STATE")" = "$candidate_name"; then
      if test "${FAIL_CANDIDATE_RM_ONCE:-false}" = true && test ! -e "$CANDIDATE_RM_FAIL_MARKER"; then
        : > "$CANDIDATE_RM_FAIL_MARKER"
        exit 1
      fi
      rm -f "$CANDIDATE_STATE"
    fi
    ;;
  inspect)
    if test "${FAIL_INSPECT:-false}" = true; then exit 1; fi
    printf '%s\n' "${CANDIDATE_HEALTH:-healthy}"
    ;;
  compose)
    case " $* " in
      *' up '*)
        if image_matches "${ASSERT_LOCK_DURING_ROLLBACK_IMAGE:-}" && test -e "$TOKEN_RELEASE_FAIL_MARKER"; then
          test -f "$BLOG_STATE_DIR/deploy.lock" || exit 1
          set -- "$BLOG_STATE_DIR"/.deploy.lock-token.*
          test "$#" -eq 1 || exit 1
          test -f "$1" || exit 1
          test "$BLOG_STATE_DIR/deploy.lock" -ef "$1" || exit 1
          test "$(cat "$BLOG_STATE_DIR/deploy.lock")" = "$(cat "$1")" || exit 1
          : > "$ROLLBACK_LOCK_ASSERTED"
        fi
        if image_matches "${FAIL_COMPOSE_BEFORE_IMAGE:-}"; then
          exit 1
        fi
        printf '%s\n' "$BLOG_IMAGE" > "$ACTIVE_IMAGE"
        if image_matches "${FAIL_COMPOSE_AFTER_IMAGE:-}"; then
          exit 1
        fi
        ;;
      *' down '*)
        if test "${FAIL_COMPOSE_DOWN:-false}" = true; then exit 1; fi
        rm -f "$ACTIVE_IMAGE"
        ;;
    esac
    ;;
esac
SH

cat > "$CURL_BIN" <<'SH'
#!/bin/sh
set -eu
url=
for arg in "$@"; do url=$arg; done
path=${url#https://gsk.minyako.top}
printf '%s\n' "$path" >> "$CURL_LOG"
active=$(cat "$ACTIVE_IMAGE" 2>/dev/null || true)

active_matches() {
  filter=$1
  if test -z "$filter"; then return 0; fi
  case "$active" in
    *"$filter"*) return 0 ;;
    *) return 1 ;;
  esac
}

if test -n "${SIGNAL_ENDPOINT:-}" && test "$path" = "$SIGNAL_ENDPOINT" && active_matches "${SIGNAL_IMAGE:-}"; then
  kill -TERM "$PPID"
  exit 22
fi

if test -n "${FAIL_ENDPOINT:-}" && test "$path" = "$FAIL_ENDPOINT" && active_matches "${FAIL_IMAGE:-}"; then
  exit 22
fi

case "$path" in
  /healthz) printf 'ok\n' ;;
  /rss.xml|/sitemap-index.xml) printf 'https://gsk.minyako.top\n' ;;
  /) printf '<html lang="zh-CN">\n' ;;
  /about|/archives) : ;;
  *) exit 22 ;;
esac
SH

cat > "$TMP/bin/mv" <<'SH'
#!/bin/sh
set -eu
dest=
for arg in "$@"; do dest=$arg; done
if test -n "${FAIL_MV_DEST:-}" && test "$dest" = "$BLOG_STATE_DIR/$FAIL_MV_DEST" && test ! -e "$MV_FAIL_MARKER"; then
  : > "$MV_FAIL_MARKER"
  exit 1
fi
exec "$REAL_MV" "$@"
SH

cat > "$TMP/bin/rm" <<'SH'
#!/bin/sh
set -eu
target=
for arg in "$@"; do
  case "$arg" in -*) : ;; *) target=$arg ;; esac
done
if test "${FAIL_LOCK_RELEASE_ONCE:-false}" = true && test "$target" = "$BLOG_STATE_DIR/deploy.lock" && test ! -e "$LOCK_RELEASE_FAIL_MARKER"; then
  : > "$LOCK_RELEASE_FAIL_MARKER"
  exit 1
fi
case "$target" in
  "${BLOG_STATE_DIR:-/nonexistent}"/.deploy.lock-token.*)
    if test "${FAIL_PRIVATE_TOKEN_RM_ONCE:-false}" = true && test ! -e "$TOKEN_RELEASE_FAIL_MARKER"; then
      : > "$TOKEN_RELEASE_FAIL_MARKER"
      exit 1
    fi
    ;;
esac
exec "$REAL_RM" "$@"
SH

cat > "$TMP/bin/date" <<'SH'
#!/bin/sh
set -eu
if test "${FAIL_DATE:-false}" = true; then exit 1; fi
exec "$REAL_DATE" "$@"
SH

cat > "$TMP/bin/ln" <<'SH'
#!/bin/sh
set -eu
target=
for arg in "$@"; do target=$arg; done
if test "$target" = "$BLOG_STATE_DIR/deploy.lock" && test "${SIGNAL_LOCK_PHASE:-}" = before; then
  kill -TERM "$PPID"
  exit 1
fi
"$REAL_LN" "$@"
if test "$target" = "$BLOG_STATE_DIR/deploy.lock" && test "${SIGNAL_LOCK_PHASE:-}" = after; then
  kill -TERM "$PPID"
fi
SH

cat > "$TMP/bin/sleep" <<'SH'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$SLEEP_LOG"
SH

chmod +x "$DOCKER_BIN" "$CURL_BIN" "$TMP/bin/date" "$TMP/bin/ln" "$TMP/bin/mv" "$TMP/bin/rm" "$TMP/bin/sleep"
export PATH=$TMP/bin:$ORIGINAL_PATH

one=1111111111111111111111111111111111111111
two=2222222222222222222222222222222222222222
three=3333333333333333333333333333333333333333
repo=ghcr.io/minyaako/blog

reset_case() {
  case_name=$1
  export BLOG_APP_DIR=$TMP/$case_name/app
  export BLOG_STATE_DIR=$BLOG_APP_DIR/state
  export BLOG_COMPOSE_FILE=$BLOG_APP_DIR/compose.yml
  export DOCKER_LOG=$TMP/$case_name/docker.log
  export CURL_LOG=$TMP/$case_name/curl.log
  export SLEEP_LOG=$TMP/$case_name/sleep.log
  export ACTIVE_IMAGE=$TMP/$case_name/active-image
  export CANDIDATE_STATE=$TMP/$case_name/candidate-state
  export CANDIDATE_RM_FAIL_MARKER=$TMP/$case_name/candidate-rm-failed
  export MV_FAIL_MARKER=$TMP/$case_name/mv-failed
  export LOCK_RELEASE_FAIL_MARKER=$TMP/$case_name/lock-release-failed
  export TOKEN_RELEASE_FAIL_MARKER=$TMP/$case_name/token-release-failed
  export ROLLBACK_LOCK_ASSERTED=$TMP/$case_name/rollback-lock-asserted
  export LOCK_ASSERTED=$TMP/$case_name/lock-asserted
  export CASE_OUTPUT=$TMP/$case_name/output.log
  unset FAIL_PULL FAIL_RUN FAIL_INSPECT CANDIDATE_HEALTH FAIL_COMPOSE_BEFORE_IMAGE
  unset FAIL_COMPOSE_AFTER_IMAGE FAIL_COMPOSE_DOWN FAIL_ENDPOINT FAIL_IMAGE
  unset SIGNAL_ENDPOINT SIGNAL_IMAGE FAIL_MV_DEST FAIL_CANDIDATE_RM_ONCE
  unset FAIL_LOCK_RELEASE_ONCE ASSERT_OWNED_LOCK
  unset FAIL_PRIVATE_TOKEN_RM_ONCE ASSERT_LOCK_DURING_ROLLBACK_IMAGE
  unset FAIL_DATE
  unset SIGNAL_LOCK_PHASE
  mkdir -p "$BLOG_STATE_DIR"
  : > "$BLOG_COMPOSE_FILE"
  : > "$DOCKER_LOG"
  : > "$CURL_LOG"
  : > "$SLEEP_LOG"
  : > "$CASE_OUTPUT"
}

make_directory_symlink() {
  link_path=$1
  target_path=$2
  mkdir -p "$target_path"
  if ln -s "$target_path" "$link_path" 2>/dev/null && test -L "$link_path"; then
    return 0
  fi
  rm -rf "$link_path"
  if command -v cmd.exe >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
    link_win=$(cygpath -w "$link_path")
    target_win=$(cygpath -w "$target_path")
    cmd.exe //c mklink //J "$link_win" "$target_win" >/dev/null 2>&1 || return 1
    test -L "$link_path"
    return
  fi
  return 1
}

assert_failure_state() {
  failed_sha=$1
  assert_eq "$failed_sha" "$(awk '{print $1}' "$BLOG_STATE_DIR/last-failure")" 'failed SHA was not recorded'
  assert_owned_lock_cleaned
}

assert_candidate_cleaned() {
  assert_missing "$CANDIDATE_STATE" 'deployment retained candidate state'
}

assert_owned_lock_cleaned() {
  assert_missing "$BLOG_STATE_DIR/deploy.lock" 'deployment retained lock entry'
  leftover=$(find "$BLOG_STATE_DIR" -maxdepth 1 \( -name '.deploy.lock-token.*' -o -name '.deploy.lock-pending.*' \) -print -quit)
  test -z "$leftover" || fail "deployment retained private lock token ($leftover)"
}

test_invalid_inputs() {
  reset_case invalid_inputs
  if "$RELEASE" deploy short-sha >/dev/null 2>&1; then fail 'short SHA was accepted'; fi
  if "$RELEASE" deploy AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA >/dev/null 2>&1; then fail 'uppercase SHA was accepted'; fi
  evil=$(printf '%s\n%s' "$one" trailing-garbage)
  if "$RELEASE" deploy "$evil" >/dev/null 2>&1; then fail 'multiline SHA was accepted'; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'invalid SHA invoked Docker'
  if "$RELEASE" status extra >/dev/null 2>&1; then fail 'status accepted an argument'; fi
  if "$RELEASE" deploy >/dev/null 2>&1; then fail 'deploy accepted no SHA'; fi
  if "$RELEASE" unknown >/dev/null 2>&1; then fail 'unknown command was accepted'; fi
}

test_success_and_safety() {
  reset_case success
  "$RELEASE" deploy "$one" >/dev/null || fail 'first release failed'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'first release did not become current'
  assert_missing "$BLOG_STATE_DIR/previous" 'first release recorded previous'
  assert_missing "$BLOG_STATE_DIR/last-failure" 'successful release retained last-failure'
  assert_owned_lock_cleaned
  assert_log "pull $repo:$one" "$DOCKER_LOG" 'release did not pull immutable image'
  assert_not_log ':latest' "$DOCKER_LOG" 'release used latest tag'
  assert_log '--read-only' "$DOCKER_LOG" 'candidate was not read-only'
  assert_log '--tmpfs /data:uid=1000,gid=1000,mode=0750' "$DOCKER_LOG" 'candidate data tmpfs was unsafe'
  assert_log '--tmpfs /config:uid=1000,gid=1000,mode=0750' "$DOCKER_LOG" 'candidate config tmpfs was unsafe'
  assert_log '--cap-drop ALL' "$DOCKER_LOG" 'candidate retained capabilities'
  assert_log '--security-opt no-new-privileges' "$DOCKER_LOG" 'candidate allowed privilege escalation'
  assert_log '--network server_proxy' "$DOCKER_LOG" 'candidate did not join server_proxy'
  assert_not_log ' -p ' "$DOCKER_LOG" 'candidate published a host port'
  assert_not_log ' --publish ' "$DOCKER_LOG" 'candidate published a host port'
  assert_candidate_cleaned 111111111111

  "$RELEASE" deploy "$two" >/dev/null || fail 'second release failed'
  assert_file_eq "$BLOG_STATE_DIR/current" "$two" 'second release did not become current'
  assert_file_eq "$BLOG_STATE_DIR/previous" "$one" 'second release did not update previous'
  assert_candidate_cleaned 222222222222
  assert_owned_lock_cleaned
  status_output=$("$RELEASE" status) || fail 'status failed for valid state'
  printf '%s\n' "$status_output" | grep -Fx "current=$two" >/dev/null || fail 'status omitted current'
  printf '%s\n' "$status_output" | grep -Fx "previous=$one" >/dev/null || fail 'status omitted previous'
}

test_endpoint_failure() {
  endpoint=$1
  label=$2
  reset_case endpoint_$label
  export FAIL_ENDPOINT=$endpoint
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail "$endpoint failure was accepted"; fi
  assert_missing "$BLOG_STATE_DIR/current" "$endpoint failure recorded current"
  assert_missing "$BLOG_STATE_DIR/previous" "$endpoint failure recorded previous"
  assert_missing "$ACTIVE_IMAGE" "$endpoint failure retained first active image"
  assert_failure_state "$one"
  assert_candidate_cleaned 111111111111
  assert_log "BLOG_IMAGE=$repo:$one compose -f $BLOG_COMPOSE_FILE down" "$DOCKER_LOG" "$endpoint failure did not stop first release"
}

test_pull_failure() {
  reset_case pull_failure
  export FAIL_PULL=true
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'pull failure was accepted'; fi
  assert_failure_state "$one"
  assert_missing "$BLOG_STATE_DIR/current" 'pull failure recorded current'
}

test_run_failure() {
  reset_case run_failure
  export FAIL_RUN=true
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'run failure was accepted'; fi
  assert_failure_state "$one"
  assert_candidate_cleaned 111111111111
}

test_inspect_failure() {
  reset_case inspect_failure
  export FAIL_INSPECT=true
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'inspect failure was accepted'; fi
  assert_failure_state "$one"
  assert_candidate_cleaned 111111111111
}

test_unhealthy_candidate() {
  reset_case unhealthy_candidate
  export CANDIDATE_HEALTH=unhealthy
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'unhealthy candidate was accepted'; fi
  assert_not_log ' compose ' "$DOCKER_LOG" 'unhealthy candidate replaced Compose service'
  assert_failure_state "$one"
  assert_candidate_cleaned 111111111111
}

test_starting_timeout() {
  reset_case starting_timeout
  export CANDIDATE_HEALTH=starting
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'starting candidate never timed out'; fi
  assert_eq 30 "$(grep -c ' inspect ' "$DOCKER_LOG")" 'candidate health attempts were not bounded'
  assert_failure_state "$one"
  assert_candidate_cleaned 111111111111
}

test_bad_state() {
  kind=$1
  reset_case bad_state_$kind
  case "$kind" in
    directory) mkdir "$BLOG_STATE_DIR/current" ;;
    trailing) printf '%s\n\n' "$one" > "$BLOG_STATE_DIR/current" ;;
    no-newline) printf '%s' "$one" > "$BLOG_STATE_DIR/current" ;;
    *) printf 'not-a-sha\n' > "$BLOG_STATE_DIR/current" ;;
  esac
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail "$kind current state was accepted"; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" "$kind current state invoked Docker"
  assert_missing "$BLOG_STATE_DIR/deploy.lock" "$kind current state retained lock"
  assert_owned_lock_cleaned
  if "$RELEASE" status >/dev/null 2>&1; then fail "status accepted $kind current state"; fi
}

test_broken_current_symlink() {
  reset_case broken_current_symlink
  target=$BLOG_STATE_DIR/broken-target
  make_directory_symlink "$BLOG_STATE_DIR/current" "$target" || fail 'could not create test symlink'
  rm -rf "$target"
  test -L "$BLOG_STATE_DIR/current" || fail 'broken current symlink was not preserved'
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'broken current symlink was accepted'; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'broken current symlink invoked Docker'
  assert_owned_lock_cleaned
  if "$RELEASE" status >/dev/null 2>&1; then fail 'status accepted broken current symlink'; fi
}

test_bad_previous_state() {
  reset_case bad_previous
  printf '%s\n' "$one" > "$BLOG_STATE_DIR/current"
  mkdir "$BLOG_STATE_DIR/previous"
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'unreadable previous state was accepted'; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'unreadable previous state invoked Docker'
  assert_missing "$BLOG_STATE_DIR/deploy.lock" 'unreadable previous state retained lock'
  assert_owned_lock_cleaned
}

test_broken_previous_symlink() {
  reset_case broken_previous_symlink
  printf '%s\n' "$one" > "$BLOG_STATE_DIR/current"
  target=$BLOG_STATE_DIR/broken-previous-target
  make_directory_symlink "$BLOG_STATE_DIR/previous" "$target" || fail 'could not create previous symlink'
  rm -rf "$target"
  test -L "$BLOG_STATE_DIR/previous" || fail 'broken previous symlink was not preserved'
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'broken previous symlink was accepted'; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'broken previous symlink invoked Docker'
  test -L "$BLOG_STATE_DIR/previous" || fail 'broken previous symlink was replaced'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'broken previous symlink changed current'
  assert_owned_lock_cleaned
}

seed_one() {
  "$RELEASE" deploy "$one" >/dev/null || fail 'could not seed first release'
  : > "$DOCKER_LOG"
  : > "$CURL_LOG"
}

test_partial_compose_rollback() {
  reset_case partial_compose
  seed_one
  export FAIL_COMPOSE_AFTER_IMAGE=$two
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'partial target Compose failure was accepted'; fi
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'partial Compose failure did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'partial Compose failure changed current'
  assert_missing "$BLOG_STATE_DIR/previous" 'partial Compose failure changed previous'
  assert_failure_state "$two"
  assert_candidate_cleaned 222222222222
}

test_owned_lock_shape() {
  reset_case owned_lock_shape
  export ASSERT_OWNED_LOCK=true
  export CANDIDATE_HEALTH=unhealthy
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'owned-lock shape test unexpectedly deployed'; fi
  test -f "$LOCK_ASSERTED" || fail 'deploy.lock was not an owned hard-link lock'
  assert_failure_state "$one"
  assert_candidate_cleaned
}

test_lock_link_signal() {
  phase=$1
  reset_case lock_link_signal_$phase
  export SIGNAL_LOCK_PHASE=$phase
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then
    fail "TERM $phase lock link was accepted"
  else
    signal_status=$?
  fi
  assert_eq 143 "$signal_status" "TERM $phase lock link lost signal status"
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" "TERM $phase lock link invoked Docker"
  assert_missing "$BLOG_STATE_DIR/last-failure" "TERM $phase lock link wrote failure state without owning lock"
  assert_owned_lock_cleaned
  assert_candidate_cleaned
}

test_empty_foreign_lock() {
  reset_case empty_foreign_lock
  : > "$BLOG_STATE_DIR/deploy.lock"
  status_output=$("$RELEASE" status) || fail 'status failed with foreign empty lock'
  printf '%s\n' "$status_output" | grep -Fx 'current=none' >/dev/null || fail 'status omitted missing current'
  test -f "$BLOG_STATE_DIR/deploy.lock" || fail 'status removed empty foreign lock'
  assert_eq 0 "$(wc -c < "$BLOG_STATE_DIR/deploy.lock" | tr -d ' ')" 'status changed empty foreign lock'
  if "$RELEASE" deploy bad-sha >/dev/null 2>&1; then fail 'invalid SHA was accepted with foreign lock'; fi
  test -f "$BLOG_STATE_DIR/deploy.lock" || fail 'invalid SHA removed empty foreign lock'
  assert_eq 0 "$(wc -c < "$BLOG_STATE_DIR/deploy.lock" | tr -d ' ')" 'invalid SHA changed empty foreign lock'
}

test_candidate_cleanup_failure() {
  reset_case candidate_cleanup_failure
  seed_one
  export FAIL_CANDIDATE_RM_ONCE=true
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'candidate cleanup failure was accepted'; fi
  assert_log 'candidate' "$CASE_OUTPUT" 'candidate cleanup failure lacked clear error'
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'candidate cleanup failure did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'candidate cleanup failure changed current'
  assert_missing "$BLOG_STATE_DIR/previous" 'candidate cleanup failure changed previous'
  assert_failure_state "$two"
  assert_candidate_cleaned
}

test_lock_release_failure() {
  reset_case lock_release_failure
  seed_one
  export FAIL_LOCK_RELEASE_ONCE=true
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'owned lock release failure was accepted'; fi
  assert_log 'lock' "$CASE_OUTPUT" 'owned lock release failure lacked clear error'
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'lock release failure did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'lock release failure did not restore current'
  assert_missing "$BLOG_STATE_DIR/previous" 'lock release failure did not restore previous'
  assert_failure_state "$two"
  assert_candidate_cleaned
}

test_private_token_release_failure() {
  reset_case private_token_release_failure
  seed_one
  export FAIL_PRIVATE_TOKEN_RM_ONCE=true
  export ASSERT_LOCK_DURING_ROLLBACK_IMAGE=$one
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'private token release failure was accepted'; fi
  assert_log 'lock' "$CASE_OUTPUT" 'private token release failure lacked clear error'
  test -f "$ROLLBACK_LOCK_ASSERTED" || fail 'rollback ran without the owned public lock'
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'private token release failure did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'private token release failure did not restore current'
  assert_missing "$BLOG_STATE_DIR/previous" 'private token release failure did not restore previous'
  assert_failure_state "$two"
  assert_candidate_cleaned
}

test_last_failure_nonregular() {
  kind=$1
  reset_case last_failure_$kind
  seed_one
  if test "$kind" = directory; then
    mkdir "$BLOG_STATE_DIR/last-failure"
  else
    target=$BLOG_STATE_DIR/last-failure-target
    make_directory_symlink "$BLOG_STATE_DIR/last-failure" "$target" || fail 'could not create last-failure symlink'
  fi
  export FAIL_ENDPOINT=/about
  export FAIL_IMAGE=$two
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail "$kind last-failure path was accepted"; fi
  assert_log 'could not record deployment failure' "$CASE_OUTPUT" "$kind last-failure lacked record error"
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" "$kind last-failure did not restore active image"
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" "$kind last-failure changed current"
  assert_missing "$BLOG_STATE_DIR/previous" "$kind last-failure changed previous"
  assert_owned_lock_cleaned
  assert_candidate_cleaned
  if test "$kind" = symlink; then test -L "$BLOG_STATE_DIR/last-failure" || fail 'last-failure symlink was replaced'; fi
}

test_date_failure() {
  reset_case date_failure
  export FAIL_ENDPOINT=/about
  export FAIL_DATE=true
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'date failure was accepted'; fi
  assert_log 'could not record deployment failure' "$CASE_OUTPUT" 'date failure was masked by atomic_write'
  assert_missing "$BLOG_STATE_DIR/last-failure" 'date failure wrote malformed last-failure'
  assert_missing "$ACTIVE_IMAGE" 'date failure retained first active image'
  assert_owned_lock_cleaned
  assert_candidate_cleaned
}

test_first_compose_down_failure() {
  reset_case first_compose_down_failure
  export FAIL_ENDPOINT=/about
  export FAIL_COMPOSE_DOWN=true
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail 'first Compose down failure was accepted'; fi
  assert_log 'rollback failed to stop first release' "$CASE_OUTPUT" 'first down failure lacked clear rollback error'
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'first down failure did not preserve active target evidence'
  assert_missing "$BLOG_STATE_DIR/current" 'first down failure recorded current'
  assert_missing "$BLOG_STATE_DIR/previous" 'first down failure recorded previous'
  assert_failure_state "$one"
  assert_candidate_cleaned
}

test_public_rollback_success() {
  reset_case public_rollback_success
  seed_one
  export FAIL_ENDPOINT=/about
  export FAIL_IMAGE=$two
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'failed target public check was accepted'; fi
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'public failure did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'public failure changed current'
  assert_missing "$BLOG_STATE_DIR/previous" 'public failure changed previous'
  assert_failure_state "$two"
  assert_candidate_cleaned 222222222222
}

test_rollback_compose_failure() {
  reset_case rollback_compose_failure
  seed_one
  export FAIL_ENDPOINT=/about
  export FAIL_IMAGE=$two
  export FAIL_COMPOSE_BEFORE_IMAGE=$one
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'rollback Compose failure was accepted'; fi
  assert_log 'rollback' "$CASE_OUTPUT" 'rollback Compose failure lacked clear error'
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$two" 'rollback Compose failure unexpectedly changed active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'rollback Compose failure changed current'
  assert_missing "$BLOG_STATE_DIR/previous" 'rollback Compose failure changed previous'
  assert_failure_state "$two"
  assert_candidate_cleaned 222222222222
}

test_rollback_public_failure() {
  reset_case rollback_public_failure
  seed_one
  export FAIL_ENDPOINT=/about
  unset FAIL_IMAGE
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'rollback public-health failure was accepted'; fi
  assert_log 'rollback' "$CASE_OUTPUT" 'rollback public-health failure lacked clear error'
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'rollback public-health failure left wrong active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'rollback public-health failure changed current'
  assert_missing "$BLOG_STATE_DIR/previous" 'rollback public-health failure changed previous'
  assert_failure_state "$two"
  assert_candidate_cleaned 222222222222
}

test_state_commit_failure() {
  reset_case state_commit_failure
  seed_one
  export FAIL_MV_DEST=current
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'current state mv failure was accepted'; fi
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'state failure did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'state failure did not restore current'
  assert_missing "$BLOG_STATE_DIR/previous" 'state failure did not restore previous snapshot'
  assert_failure_state "$two"
  assert_candidate_cleaned 222222222222
}

test_previous_snapshot_restore() {
  reset_case previous_snapshot_restore
  "$RELEASE" deploy "$one" >/dev/null || fail 'could not seed first release'
  "$RELEASE" deploy "$two" >/dev/null || fail 'could not seed second release'
  : > "$DOCKER_LOG"
  : > "$CURL_LOG"
  export FAIL_MV_DEST=current
  if "$RELEASE" deploy "$three" >"$CASE_OUTPUT" 2>&1; then fail 'third-release state mv failure was accepted'; fi
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$two" 'snapshot rollback did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$two" 'snapshot rollback did not restore current'
  assert_file_eq "$BLOG_STATE_DIR/previous" "$one" 'snapshot rollback did not restore previous'
  assert_failure_state "$three"
  assert_candidate_cleaned 333333333333
}

test_term_rollback() {
  reset_case term_rollback
  seed_one
  export SIGNAL_ENDPOINT=/about
  export SIGNAL_IMAGE=$two
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then
    fail 'TERM during public check was accepted'
  else
    term_status=$?
  fi
  assert_eq 143 "$term_status" 'TERM did not preserve signal exit status'
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'TERM did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'TERM changed current state'
  assert_failure_state "$two"
  assert_candidate_cleaned 222222222222
}

test_lock_contention() {
  reset_case lock_contention
  printf 'sentinel failure\n' > "$BLOG_STATE_DIR/last-failure"
  printf 'foreign-owner\n' > "$BLOG_STATE_DIR/deploy.lock"
  if "$RELEASE" deploy "$three" >/dev/null 2>&1; then fail 'concurrent deployment was accepted'; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'lock contention invoked Docker'
  assert_file_eq "$BLOG_STATE_DIR/deploy.lock" foreign-owner 'contender changed foreign deployment lock'
  assert_file_eq "$BLOG_STATE_DIR/last-failure" 'sentinel failure' 'contender changed shared last-failure state'
  leftover=$(find "$BLOG_STATE_DIR" -maxdepth 1 \( -name '.deploy.lock-token.*' -o -name '.deploy.lock-pending.*' \) -print -quit)
  test -z "$leftover" || fail "contender retained private lock token ($leftover)"
}

failures=0
run_case() {
  case_label=$1
  shift
  if test -n "${CASE_FILTER:-}" && test "$CASE_FILTER" != "$case_label"; then
    return
  fi
  set +e
  ( set -e; "$@" )
  case_status=$?
  set -e
  if test "$case_status" -eq 0; then
    echo "ok - $case_label"
  else
    echo "not ok - $case_label" >&2
    failures=$((failures + 1))
  fi
}

run_case invalid-inputs test_invalid_inputs
run_case success-and-safety test_success_and_safety
run_case endpoint-health test_endpoint_failure /healthz health
run_case endpoint-root test_endpoint_failure / root
run_case endpoint-about test_endpoint_failure /about about
run_case endpoint-archives test_endpoint_failure /archives archives
run_case endpoint-rss test_endpoint_failure /rss.xml rss
run_case endpoint-sitemap test_endpoint_failure /sitemap-index.xml sitemap
run_case pull-failure test_pull_failure
run_case run-failure test_run_failure
run_case inspect-failure test_inspect_failure
run_case unhealthy-candidate test_unhealthy_candidate
run_case starting-timeout test_starting_timeout
run_case current-directory test_bad_state directory
run_case current-corrupt test_bad_state corrupt
run_case current-trailing-blank test_bad_state trailing
run_case current-no-newline test_bad_state no-newline
run_case current-broken-symlink test_broken_current_symlink
run_case previous-directory test_bad_previous_state
run_case previous-broken-symlink test_broken_previous_symlink
run_case owned-lock-shape test_owned_lock_shape
run_case lock-link-signal-before test_lock_link_signal before
run_case lock-link-signal-after test_lock_link_signal after
run_case empty-foreign-lock test_empty_foreign_lock
run_case partial-compose-rollback test_partial_compose_rollback
run_case candidate-cleanup-failure test_candidate_cleanup_failure
run_case lock-release-failure test_lock_release_failure
run_case private-token-release-failure test_private_token_release_failure
run_case last-failure-directory test_last_failure_nonregular directory
run_case last-failure-symlink test_last_failure_nonregular symlink
run_case failure-timestamp test_date_failure
run_case first-compose-down-failure test_first_compose_down_failure
run_case public-rollback-success test_public_rollback_success
run_case rollback-compose-failure test_rollback_compose_failure
run_case rollback-public-failure test_rollback_public_failure
run_case state-commit-failure test_state_commit_failure
run_case previous-snapshot-restore test_previous_snapshot_restore
run_case term-rollback test_term_rollback
run_case lock-contention test_lock_contention

test "$failures" -eq 0 || {
  echo "not ok - $failures deployment scenario(s) failed" >&2
  exit 1
}
echo 'ok - all blog release scenarios'
