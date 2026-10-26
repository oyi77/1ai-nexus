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
# Verify the compressed plain-SQL dump before evicting any older backup.
gzip -t "$OUT"
gunzip -c "$OUT" | tail -c 200 | grep -q 'PostgreSQL database dump complete'
ls -t backups/db-*.sql.gz | tail -n +8 | xargs -r rm --
echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"
echo "backup-integrity: OK (plain SQL; full restore tested separately on isolated PostgreSQL)"
