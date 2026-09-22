#!/usr/bin/env bash
# ── NEXUS automated DB backup ──────────────────────────────────
# Dumps full schema+data (single-table dumps lose Prisma enums — proven
# 2026-09-22: Subscription/User restore needs the full 76-table dump).
# Keeps 7 daily rotations. Install: crontab -e → 0 3 * * * /path/backup-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="backups/db-$(date +%Y%m%d).sql.gz"
mkdir -p backups
pg_dump "$DATABASE_URL" --no-owner --no-privileges 2>/dev/null | gzip > "$OUT" \
  || docker compose exec -T postgres pg_dump -U nexus nexus 2>/dev/null | gzip > "$OUT"
ls -t backups/db-*.sql.gz | tail -n +8 | xargs -r rm --
echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"
# Prove it restores: full schema must apply with zero errors.
TMPDB="nexus_restore_verify"
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS $TMPDB;" -c "CREATE DATABASE $TMPDB;" >/dev/null
gunzip -c "$OUT" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -d "$TMPDB" >/dev/null 2>&1 \
  && echo "restore-proof: OK" \
  || { echo "restore-proof: FAILED"; exit 1; }
psql "$DATABASE_URL" -c "DROP DATABASE $TMPDB;" >/dev/null
