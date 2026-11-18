#!/usr/bin/env bash
# Daily backup of the platform: Postgres dump (compressed) + photo snapshot.
#
# - Database: pg_dump | zstd -19 -> db-YYYYmmdd-HHMM.sql.zst
# - Photos: originals are already compressed images, so instead of re-zipping
#   them every day we keep daily snapshots with rsync --link-dest: unchanged
#   files are hard links, so 7 days of snapshots cost about the space of one.
# - Retention: anything older than KEEP_DAYS (default 7) is deleted.
#
# Installed by infra/deploy/ops/install.sh; runs from /etc/cron.d/photo-platform.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/photo-platform/src/infra/deploy}"
BACKUP_DIR="${BACKUP_DIR:-/opt/photo-platform/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date -u +%Y%m%d-%H%M)"

exec 9>/run/photo-platform-backup.lock
flock -n 9 || { echo "$(date -u -Is) another backup is running"; exit 0; }

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/media"
chmod 700 "$BACKUP_DIR"

# --- Database ---------------------------------------------------------------------
db_file="$BACKUP_DIR/db/db-$STAMP.sql.zst"
docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U photo_platform -d photo_platform --no-owner \
  | zstd -q -19 -T0 -o "$db_file.partial"
# A dump that does not end with the completion marker is not a valid backup.
zstd -dc "$db_file.partial" | tail -n 5 | grep -q "PostgreSQL database dump complete"
mv "$db_file.partial" "$db_file"
chmod 600 "$db_file"

# --- Photos -----------------------------------------------------------------------
media_src="$(docker volume inspect photo-platform-prod_media --format '{{.Mountpoint}}')"
latest="$(ls -1d "$BACKUP_DIR"/media/media-* 2>/dev/null | sort | tail -n 1 || true)"
target="$BACKUP_DIR/media/media-$STAMP"
rsync -a --delete ${latest:+--link-dest="$latest"} "$media_src/" "$target.partial/"
mv "$target.partial" "$target"

# --- Retention --------------------------------------------------------------------
find "$BACKUP_DIR/db" -maxdepth 1 -name 'db-*.sql.zst' -mtime +"$((KEEP_DAYS - 1))" -delete
# Manual pre-deploy dumps (*.sql.gz) follow the same retention.
find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -mtime +"$((KEEP_DAYS - 1))" -delete
find "$BACKUP_DIR/media" -maxdepth 1 -mindepth 1 -type d -name 'media-*' -mtime +"$((KEEP_DAYS - 1))" -exec rm -rf {} +
# Leftovers from interrupted runs.
find "$BACKUP_DIR" -name '*.partial' -mmin +120 -exec rm -rf {} + 2>/dev/null || true

echo "$(date -u -Is) ok db=$(du -h "$db_file" | cut -f1) media=$(du -sh "$target" | cut -f1) total=$(du -sh "$BACKUP_DIR" | cut -f1)"
