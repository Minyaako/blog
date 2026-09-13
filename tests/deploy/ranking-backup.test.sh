#!/bin/sh
set -eu
# Run on Linux as root (a disposable Node container is sufficient); Docker is mocked.
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
script=$root/deploy/ranking/ranking-backup
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
export RANKING_BACKUP_ROOT=$tmp/backups RANKING_DATA_DIR=$tmp/data
export RANKING_BACKUP_IMAGE=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export RANKING_DOCKER_BIN=$tmp/docker MOCK_LOG=$tmp/docker.log
mkdir -m 700 "$RANKING_BACKUP_ROOT" "$RANKING_DATA_DIR"
printf 'consistent snapshot\n' > "$RANKING_DATA_DIR/ranking.sqlite"
chmod 600 "$RANKING_DATA_DIR/ranking.sqlite"
chown -R 1000:1000 "$RANKING_DATA_DIR"
cat > "$RANKING_DOCKER_BIN" <<'MOCK'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$MOCK_LOG"
source= destination=
for arg in "$@"; do
  case "$arg" in
    type=bind,src=*,dst=/data,readonly) source=${arg#type=bind,src=}; source=${source%,dst=/data,readonly} ;;
    type=bind,src=*,dst=/snapshot*) destination=${arg#type=bind,src=}; destination=${destination%%,dst=*} ;;
  esac
done
case " $* " in
  *' backup /snapshot/database.sqlite '*)
    test "${MOCK_BACKUP_FAIL:-0}" = 0 || exit 1
    cp "$source/ranking.sqlite" "$destination/database.sqlite"
    ;;
  *' check '*)
    test "${MOCK_CHECK_FAIL:-0}" = 0 || exit 1
    grep -q 'consistent snapshot' "$destination/database.sqlite"
    ;;
  *' --input-type=module -e '*)
    test -f "$destination/database.sqlite"
    ;;
  *) exit 1 ;;
esac
MOCK
chmod 700 "$RANKING_DOCKER_BIN"
fail() { printf 'not ok - %s\n' "$*" >&2; exit 1; }
run() { sh "$script" "$@"; }
first=$(run backup)
test -f "$first/database.sqlite" || fail 'missing backup'
test "$(stat -c %a "$first/database.sqlite")" = 600 || fail 'backup permission'
original=$(sha256sum "$RANKING_DATA_DIR/ranking.sqlite")
: > "$MOCK_LOG"
run verify "$first"
test "$original" = "$(sha256sum "$RANKING_DATA_DIR/ranking.sqlite")" || fail 'verification changed source'
if grep -q 'dst=/data' "$MOCK_LOG"; then fail 'verification mounted live data'; fi
second=$(run backup)
test "$first" != "$second" || fail 'same-second backups collided'
test -f "$first/database.sqlite" || fail 'previous artifact overwritten'
test "$(find "$RANKING_BACKUP_ROOT/weekly" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 1 || fail 'duplicate weekly archive'
printf 'tampered\n' >> "$first/database.sqlite"
if run verify "$first" >/dev/null 2>&1; then fail 'corrupt checksum accepted'; fi
if run verify "$RANKING_DATA_DIR" >/dev/null 2>&1; then fail 'out-of-root verification accepted'; fi
ln -s "$second" "$RANKING_BACKUP_ROOT/daily/ranking-link"
if run verify "$RANKING_BACKUP_ROOT/daily/ranking-link" >/dev/null 2>&1; then fail 'symlink archive accepted'; fi
rm "$RANKING_BACKUP_ROOT/daily/ranking-link"
export MOCK_CHECK_FAIL=1
before=$(find "$RANKING_BACKUP_ROOT/daily" -mindepth 1 -maxdepth 1 -type d | wc -l)
if run backup >/dev/null 2>&1; then fail 'failed integrity check published'; fi
test "$before" -eq "$(find "$RANKING_BACKUP_ROOT/daily" -mindepth 1 -maxdepth 1 -type d | wc -l)" || fail 'failed backup was published'
unset MOCK_CHECK_FAIL
test ! -e "$RANKING_BACKUP_ROOT/.lock" || fail 'lock retained after failure'
test -z "$(find "$RANKING_BACKUP_ROOT" -maxdepth 1 -name '.work-*')" || fail 'staging retained after failure'
for kind in daily weekly; do
  for number in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16; do
    cp -a "$second" "$RANKING_BACKUP_ROOT/$kind/ranking-2000-$number"
  done
done
run backup >/dev/null
test "$(find "$RANKING_BACKUP_ROOT/daily" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 14 || fail 'daily retention is not 14'
test "$(find "$RANKING_BACKUP_ROOT/weekly" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 8 || fail 'weekly retention is not 8'
mkdir "$RANKING_BACKUP_ROOT/.lock"
if run backup >/dev/null 2>&1; then fail 'concurrent backup accepted'; fi
test -d "$RANKING_BACKUP_ROOT/.lock" || fail 'foreign lock removed'
rmdir "$RANKING_BACKUP_ROOT/.lock"
chmod 755 "$RANKING_BACKUP_ROOT"
if run backup >/dev/null 2>&1; then fail 'loose permissions accepted'; fi
printf '%s\n' 'ok - snapshot verification, no overwrite, corruption/symlink rejection, lock, permissions, daily14/weekly8'
