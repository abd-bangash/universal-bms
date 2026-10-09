#!/usr/bin/env bash
# Restores a backup into a scratch database and checks that the data is there, then drops it.
# This is the rehearsal that proves a backup can be used. Usage:
#   ADMIN_DATABASE_URL=postgresql://.../postgres scripts/restore-test.sh path/to/bms-....dump
set -euo pipefail

: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL (a connection that may create databases) is required}"
dump="${1:?Usage: restore-test.sh <dump file>}"
scratch="bms_restore_test_$(date -u +%Y%m%d%H%M%S)"
scratch_url="${ADMIN_DATABASE_URL%/*}/$scratch"

psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$scratch\""
trap 'psql "$ADMIN_DATABASE_URL" -c "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null' EXIT

pg_restore --no-owner --no-privileges --dbname="$scratch_url" "$dump"

q() { psql "$scratch_url" -tA -c "$1"; }
workspaces="$(q 'SELECT count(*) FROM workspaces')"
users="$(q 'SELECT count(*) FROM users')"
migrations="$(q 'SELECT count(*) FROM _prisma_migrations')"
orders="$(q 'SELECT count(*) FROM orders')"
audit="$(q 'SELECT count(*) FROM audit_events')"
echo "Restored into $scratch: workspaces=$workspaces users=$users orders=$orders audit_events=$audit migrations=$migrations"
[ "$workspaces" -gt 0 ] && [ "$migrations" -gt 0 ] || { echo "Restore check FAILED: the data is not there." >&2; exit 1; }
echo "Restore check passed on $(date -u +%Y-%m-%d)."
