#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RELEASE=$ROOT/deploy/bin/blog-release
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

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

cat > "$DOCKER_BIN" <<'SH'
#!/bin/sh
set -eu
printf 'BLOG_IMAGE=%s %s\n' "${BLOG_IMAGE:-}" "$*" >> "$DOCKER_LOG"
case ${1:-} in
  inspect)
    printf '%s\n' "${CANDIDATE_HEALTH:-healthy}"
    ;;
  compose)
    case " $* " in
      *' up '*) printf '%s\n' "$BLOG_IMAGE" > "$ACTIVE_IMAGE" ;;
      *' down '*) rm -f "$ACTIVE_IMAGE" ;;
    esac
    ;;
esac
SH

cat > "$CURL_BIN" <<'SH'
#!/bin/sh
set -eu
url=
for arg in "$@"; do url=$arg; done
printf '%s\n' "$url" >> "$CURL_LOG"
active=$(cat "$ACTIVE_IMAGE" 2>/dev/null || true)
if test -n "${FAIL_IMAGE:-}" && printf '%s\n' "$active" | grep -F "$FAIL_IMAGE" >/dev/null; then
  exit 22
fi
case "$url" in
  */healthz) printf 'ok\n' ;;
  */rss.xml|*/sitemap-index.xml) printf 'https://gsk.minyako.top\n' ;;
  */) printf '<html lang="zh-CN">\n' ;;
  */about|*/archives) : ;;
  *) exit 22 ;;
esac
SH

chmod +x "$DOCKER_BIN" "$CURL_BIN"

reset_case() {
  case_name=$1
  export BLOG_APP_DIR=$TMP/$case_name/app
  export BLOG_STATE_DIR=$BLOG_APP_DIR/state
  export BLOG_COMPOSE_FILE=$BLOG_APP_DIR/compose.yml
  export DOCKER_LOG=$TMP/$case_name/docker.log
  export CURL_LOG=$TMP/$case_name/curl.log
  export ACTIVE_IMAGE=$TMP/$case_name/active-image
  unset FAIL_IMAGE CANDIDATE_HEALTH
  mkdir -p "$BLOG_STATE_DIR"
  : > "$BLOG_COMPOSE_FILE"
  : > "$DOCKER_LOG"
  : > "$CURL_LOG"
}

one=1111111111111111111111111111111111111111
two=2222222222222222222222222222222222222222
three=3333333333333333333333333333333333333333
repo=ghcr.io/minyaako/blog

reset_case invalid_sha
if "$RELEASE" deploy short-sha >/dev/null 2>&1; then
  fail 'short SHA was accepted'
fi
if "$RELEASE" deploy AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA >/dev/null 2>&1; then
  fail 'uppercase SHA was accepted'
fi
assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'invalid SHA invoked Docker'

if "$RELEASE" status extra >/dev/null 2>&1; then
  fail 'status accepted an argument'
fi
if "$RELEASE" deploy >/dev/null 2>&1; then
  fail 'deploy accepted no SHA'
fi
if "$RELEASE" unknown >/dev/null 2>&1; then
  fail 'unknown command was accepted'
fi

reset_case successful_releases
"$RELEASE" deploy "$one" >/dev/null
assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'first release did not become current'
assert_missing "$BLOG_STATE_DIR/previous" 'first release recorded a previous SHA'
assert_missing "$BLOG_STATE_DIR/last-failure" 'successful release retained last-failure'
assert_missing "$BLOG_STATE_DIR/deploy.lock" 'successful release retained lock'
assert_log "pull $repo:$one" "$DOCKER_LOG" 'release did not pull the immutable image'
assert_not_log ':latest' "$DOCKER_LOG" 'release used the latest tag'
assert_log '--network server_proxy' "$DOCKER_LOG" 'candidate did not join server_proxy'
assert_not_log ' -p ' "$DOCKER_LOG" 'candidate published a host port'
assert_not_log ' --publish ' "$DOCKER_LOG" 'candidate published a host port'
assert_log "rm -f blog-candidate-111111111111" "$DOCKER_LOG" 'candidate was not cleaned up'

"$RELEASE" deploy "$two" >/dev/null
assert_file_eq "$BLOG_STATE_DIR/current" "$two" 'second release did not become current'
assert_file_eq "$BLOG_STATE_DIR/previous" "$one" 'second release did not update previous'
assert_missing "$BLOG_STATE_DIR/deploy.lock" 'second release retained lock'
status_output=$("$RELEASE" status)
printf '%s\n' "$status_output" | grep -Fx "current=$two" >/dev/null || fail 'status omitted current SHA'
printf '%s\n' "$status_output" | grep -Fx "previous=$one" >/dev/null || fail 'status omitted previous SHA'
for endpoint in /healthz / /about /archives /rss.xml /sitemap-index.xml; do
  assert_log "https://gsk.minyako.top$endpoint" "$CURL_LOG" "public check omitted $endpoint"
done

reset_case unhealthy_candidate
export CANDIDATE_HEALTH=unhealthy
if "$RELEASE" deploy "$one" >/dev/null 2>&1; then
  fail 'unhealthy candidate was accepted'
fi
assert_missing "$BLOG_STATE_DIR/current" 'unhealthy candidate recorded current'
assert_missing "$BLOG_STATE_DIR/deploy.lock" 'unhealthy candidate retained lock'
assert_log "rm -f blog-candidate-111111111111" "$DOCKER_LOG" 'unhealthy candidate was not cleaned up'
assert_not_log ' compose ' "$DOCKER_LOG" 'unhealthy candidate replaced Compose service'

reset_case failed_first_release
export FAIL_IMAGE=111111111111
if "$RELEASE" deploy "$one" >/dev/null 2>&1; then
  fail 'failed first public check was accepted'
fi
unset FAIL_IMAGE
assert_missing "$BLOG_STATE_DIR/current" 'failed first release recorded current'
assert_eq "$one" "$(awk '{print $1}' "$BLOG_STATE_DIR/last-failure")" 'failed first release was not recorded'
assert_log "BLOG_IMAGE=$repo:$one compose -f $BLOG_COMPOSE_FILE down" "$DOCKER_LOG" 'failed first release did not stop Compose service'
assert_missing "$BLOG_STATE_DIR/deploy.lock" 'failed first release retained lock'
assert_log "rm -f blog-candidate-111111111111" "$DOCKER_LOG" 'failed first release retained candidate'

reset_case rollback
"$RELEASE" deploy "$one" >/dev/null
export FAIL_IMAGE=222222222222
if "$RELEASE" deploy "$two" >/dev/null 2>&1; then
  fail 'failed target public check was accepted'
fi
unset FAIL_IMAGE
assert_file_eq "$BLOG_STATE_DIR/current" "$one" 'rollback did not restore current SHA'
assert_eq "$two" "$(awk '{print $1}' "$BLOG_STATE_DIR/last-failure")" 'failed target was not recorded'
assert_file_eq "$ACTIVE_IMAGE" "$repo:$one" 'rollback did not restore active image'
assert_log "BLOG_IMAGE=$repo:$two compose -f $BLOG_COMPOSE_FILE up" "$DOCKER_LOG" 'target Compose replacement was not attempted'
assert_log "BLOG_IMAGE=$repo:$one compose -f $BLOG_COMPOSE_FILE up" "$DOCKER_LOG" 'previous Compose release was not restored'
assert_missing "$BLOG_STATE_DIR/deploy.lock" 'rollback retained lock'
assert_log "rm -f blog-candidate-222222222222" "$DOCKER_LOG" 'rollback retained candidate'

reset_case lock_contention
mkdir "$BLOG_STATE_DIR/deploy.lock"
if "$RELEASE" deploy "$three" >/dev/null 2>&1; then
  fail 'concurrent deployment was accepted'
fi
assert_eq 0 "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" 'lock contention invoked Docker'
test -d "$BLOG_STATE_DIR/deploy.lock" || fail 'contending process removed another deployment lock'

echo 'ok - blog release state machine'
