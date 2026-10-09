#!/usr/bin/env bash
# Takes a compressed dump of the database, checks that it can be read, and (optionally) tells the
# application so the Owner's system status page shows the time. Usage:
#   DATABASE_URL=postgresql://... scripts/backup.sh [output-directory]
# Keep the file somewhere other than the database's own server (Requirement 52.5).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
dir="${1:-./backups}"
mkdir -p "$dir"
file="$dir/bms-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --format=custom --no-owner --no-privileges --file="$file" "$DATABASE_URL"
# a dump that cannot be listed is not a backup
pg_restore --list "$file" >/dev/null
size="$(du -h "$file" | cut -f1)"
echo "Backup written: $file ($size)"

if [ -n "${BACKUP_RECORD_COMMAND:-}" ]; then
  # e.g. BACKUP_RECORD_COMMAND="pnpm --filter api backup:record"
  $BACKUP_RECORD_COMMAND --note "$(basename "$file"), $size"
fi
