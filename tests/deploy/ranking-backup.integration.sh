#!/bin/sh
set -eu
# Linux-only real Docker test. Caller supplies an empty, task-owned Docker volume
# mounted at its own host Mountpoint, and an already-built immutable blog image.
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
work=${RANKING_INTEGRATION_ROOT:?dedicated integration volume path required}
case "$work" in /var/lib/docker/volumes/ranking-backup-integration-*/_data) ;; *) exit 64 ;; esac
test "$(realpath "$work")" = "$work"
test -z "$(ls -A "$work")"
export RANKING_DATA_DIR=$work/data RANKING_BACKUP_ROOT=$work/backups
test -n "${RANKING_BACKUP_IMAGE:-}"
writer=${work#/var/lib/docker/volumes/}
writer=${writer%/_data}-wal
writer_started=false
cleanup() { if test "$writer_started" = true; then docker rm -f "$writer" >/dev/null; fi; }
trap cleanup EXIT HUP INT TERM
mkdir -m 700 "$RANKING_DATA_DIR" "$RANKING_BACKUP_ROOT" "$work/offsite"
chown 1000:1000 "$RANKING_DATA_DIR"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 1000:1000 --mount "type=bind,src=$RANKING_DATA_DIR,dst=/var/lib/blog-ranking" \
  --entrypoint node "$RANKING_BACKUP_IMAGE" --experimental-transform-types scripts/ranking-db.ts init
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 1000:1000 --mount "type=bind,src=$RANKING_DATA_DIR,dst=/var/lib/blog-ranking" \
  --entrypoint node "$RANKING_BACKUP_IMAGE" --input-type=module -e \
  'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync("/var/lib/blog-ranking/ranking.sqlite"); db.exec("INSERT INTO users VALUES ('"'"'integration-test'"'"', '"'"'Backup test'"'"', '"'"'2026-09-13'"'"')"); db.close();'
docker run -d --rm --name "$writer" --label codex.task=ranking-backup-integration \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 \
  --mount "type=bind,src=$RANKING_DATA_DIR,dst=/var/lib/blog-ranking" --entrypoint node \
  "$RANKING_BACKUP_IMAGE" --input-type=module -e \
  'import {DatabaseSync} from "node:sqlite"; import {writeFileSync} from "node:fs"; const db=new DatabaseSync("/var/lib/blog-ranking/ranking.sqlite"); db.exec("PRAGMA journal_mode=WAL; INSERT INTO users VALUES ('"'"'wal-test'"'"', '"'"'WAL test'"'"', '"'"'2026-09-13'"'"')"); writeFileSync("/var/lib/blog-ranking/writer.ready","ready"); setInterval(()=>{},1000);' >/dev/null
writer_started=true
attempt=0
while test ! -f "$RANKING_DATA_DIR/writer.ready"; do
  attempt=$((attempt + 1)); test "$attempt" -lt 10; sleep 1
done
before=$(sha256sum "$RANKING_DATA_DIR/ranking.sqlite")
archive=$(sh "$root/deploy/ranking/ranking-backup" backup)
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 0:0 --mount "type=bind,src=$archive,dst=/snapshot,readonly" --entrypoint node \
  "$RANKING_BACKUP_IMAGE" --input-type=module -e \
  'import assert from "node:assert/strict"; import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync("/snapshot/database.sqlite",{readOnly:true}); assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n,2); db.close();'
sh "$root/deploy/ranking/ranking-backup" verify "$archive"
test "$before" = "$(sha256sum "$RANKING_DATA_DIR/ranking.sqlite")"
mkdir -m 700 "$work/offsite/daily"
cp -a "$archive" "$work/offsite/daily/"
RANKING_BACKUP_ROOT=$work/offsite sh "$root/deploy/ranking/ranking-backup" verify "$work/offsite/daily/${archive##*/}"
test "$before" = "$(sha256sum "$RANKING_DATA_DIR/ranking.sqlite")"
printf '%s\n' 'ok - real SQLite WAL snapshot, read-only source, isolated verification, copied offsite verification'
