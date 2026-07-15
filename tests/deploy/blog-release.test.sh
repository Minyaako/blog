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
  test ! -e "$1" || fail "$2 ($1 exists)"
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
    ;;
  run)
    if test "${FAIL_RUN:-false}" = true; then exit 1; fi
    printf 'candidate-id\n'
    ;;
  inspect)
    if test "${FAIL_INSPECT:-false}" = true; then exit 1; fi
    printf '%s\n' "${CANDIDATE_HEALTH:-healthy}"
    ;;
  compose)
    case " $* " in
      *' up '*)
        if image_matches "${FAIL_COMPOSE_BEFORE_IMAGE:-}"; then
          exit 1
        fi
        printf '%s\n' "$BLOG_IMAGE" > "$ACTIVE_IMAGE"
        if image_matches "${FAIL_COMPOSE_AFTER_IMAGE:-}"; then
          exit 1
        fi
        ;;
      *' down '*)
        rm -f "$ACTIVE_IMAGE"
        if test "${FAIL_COMPOSE_DOWN:-false}" = true; then exit 1; fi
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

cat > "$TMP/bin/sleep" <<'SH'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$SLEEP_LOG"
SH

chmod +x "$DOCKER_BIN" "$CURL_BIN" "$TMP/bin/mv" "$TMP/bin/sleep"
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
  export MV_FAIL_MARKER=$TMP/$case_name/mv-failed
  export CASE_OUTPUT=$TMP/$case_name/output.log
  unset FAIL_PULL FAIL_RUN FAIL_INSPECT CANDIDATE_HEALTH FAIL_COMPOSE_BEFORE_IMAGE
  unset FAIL_COMPOSE_AFTER_IMAGE FAIL_COMPOSE_DOWN FAIL_ENDPOINT FAIL_IMAGE
  unset SIGNAL_ENDPOINT SIGNAL_IMAGE FAIL_MV_DEST
  mkdir -p "$BLOG_STATE_DIR"
  : > "$BLOG_COMPOSE_FILE"
  : > "$DOCKER_LOG"
  : > "$CURL_LOG"
  : > "$SLEEP_LOG"
  : > "$CASE_OUTPUT"
}

assert_failure_state() {
  failed_sha=$1
  assert_eq "$failed_sha" "$(awk '{print $1}' "$BLOG_STATE_DIR/last-failure")" 'failed SHA was not recorded'
  assert_missing "$BLOG_STATE_DIR/deploy.lock" 'failed deployment retained lock'
}

assert_candidate_cleaned() {
  short_sha=$1
  assert_log "rm -f blog-candidate-$short_sha" "$DOCKER_LOG" 'failed deployment retained candidate'
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
  assert_missing "$BLOG_STATE_DIR/deploy.lock" 'successful release retained lock'
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
  if test "$kind" = directory; then
    mkdir "$BLOG_STATE_DIR/current"
  else
    printf 'not-a-sha\n' > "$BLOG_STATE_DIR/current"
  fi
  if "$RELEASE" deploy "$one" >"$CASE_OUTPUT" 2>&1; then fail "$kind current state was accepted"; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" "$kind current state invoked Docker"
  assert_missing "$BLOG_STATE_DIR/deploy.lock" "$kind current state retained lock"
  if "$RELEASE" status >/dev/null 2>&1; then fail "status accepted $kind current state"; fi
}

test_bad_previous_state() {
  reset_case bad_previous
  printf '%s\n' "$one" > "$BLOG_STATE_DIR/current"
  mkdir "$BLOG_STATE_DIR/previous"
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'unreadable previous state was accepted'; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'unreadable previous state invoked Docker'
  assert_missing "$BLOG_STATE_DIR/deploy.lock" 'unreadable previous state retained lock'
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
  assert_failure_state "$two"
  assert_candidate_cleaned 222222222222
}

test_public_rollback_success() {
  reset_case public_rollback_success
  seed_one
  export FAIL_ENDPOINT=/about
  export FAIL_IMAGE=$two
  if "$RELEASE" deploy "$two" >"$CASE_OUTPUT" 2>&1; then fail 'failed target public check was accepted'; fi
  assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'public failure did not restore active image'
  assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'public failure changed current'
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
  mkdir "$BLOG_STATE_DIR/deploy.lock"
  if "$RELEASE" deploy "$three" >/dev/null 2>&1; then fail 'concurrent deployment was accepted'; fi
  assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'lock contention invoked Docker'
  test -d "$BLOG_STATE_DIR/deploy.lock" || fail 'contender removed another deployment lock'
}

failures=0
run_case() {
  case_label=$1
  shift
  if test -n "${CASE_FILTER:-}" && test "$CASE_FILTER" != "$case_label"; then
    return
  fi
  if ( "$@" ); then
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
run_case previous-directory test_bad_previous_state
run_case partial-compose-rollback test_partial_compose_rollback
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
