# NEXUS — Buyer Handover Runbook

Verified 2026-09-22 against HEAD `git rev-parse --short HEAD` (verify: tree must be clean). Follow in order; every step has
a check so you know it worked before moving on.

## 1. What you bought

- Next.js 16 terminal (port 4400) + WS sidecar (4401) + PostgreSQL 16 + Redis 7
- 100+ pages, measured signal brief, user auth, Midtrans/Tripay billing,
  per-user API keys, admin panel
- Production reference: https://tracker.aitradepulse.com

## 2. First boot (buyer machine)

```bash
git clone https://github.com/oyi77/1ai-nexus.git 1ai-tracker
cd 1ai-tracker
cp .env.example .env
# Fill REQUIRED (see .env.example header): DATABASE_URL, JWT_SECRET,
# NEXTAUTH_SECRET, NEXT_PUBLIC_APP_URL, SECRETS_MASTER_KEY,
# ONEAI_PAYMENT_API_KEY/BASE_URL/WEBHOOK_SECRET
openssl rand -hex 32  # use for JWT_SECRET / NEXTAUTH_SECRET / SECRETS_MASTER_KEY
# The lockfile expects the private SDK archive at this exact sibling path.
mkdir -p ../1ai-payment/packages/sdk
cp vendor/1ai-payment-0.1.0.tgz ../1ai-payment/packages/sdk/
npm ci  # verifies the lockfile sha512; see vendor/PROVENANCE.json
npx prisma migrate deploy   # NEVER db:push on a migrated DB — ledger drift
npm run build
pm2 start ecosystem.config.js --only 1ai-tracker-web
curl -s localhost:4400/api/v1/health | head -c 200
```

Check: health returns 200 with `{ data: { status: "ok" } }`.

`db-init` in Docker Compose also only applies migrations. Do not run `npm run db:seed` against handover or production data: it generates synthetic demo data and aborts unless both `User` and `Entity` tables are empty.

**Execution safety:** this repository is screening/research-only: `SHADOW`/`PAPER` and backtests are simulated. It has no live order or on-chain execution path; `SNIPER_EXECUTE_ENABLED` cannot enable trading.

## 3. Admin bootstrap

1. Sign up at `/signup` — the FIRST user becomes usable immediately.
2. Promote to admin in psql:
   `UPDATE "User" SET role='admin' WHERE email='you@example.com';`
3. Verify: `/admin` renders, `/api/v1/admin/users` returns 200 with your JWT.
4. Stage integration keys at Admin → Integrations (values never echoed back).

## 4. Billing go-live

1. Create 1ai-payment merchant, set `ONEAI_PAYMENT_*` in `.env`, restart web.
2. Set plan prices once in `src/lib/pricing.ts` (single source).
3. Test with a Rp1.000 order: `/pricing` → pay → webhook `paid` →
   `/account` shows Pro with endDate +30d.
4. Webhook contract: missing userId/plan on a `paid` order returns 400 so
   the gateway retries — a 200 means activated or explicitly terminal.

## 5. Backup & restore (do this BEFORE you need it)

```bash
# Backup (daily cron recommended). .env supplies DATABASE_URL:
set -a; . ./.env; set +a
bash scripts/backup-db.sh  # writes backups/db-YYYYMMDD.sql.gz and gzip-tests it

# Restore only into a newly created scratch DB, as a role allowed to create/drop databases:
BACKUP=backups/db-YYYYMMDD.sql.gz
RESTORE_DB="nexus-restore-$(date +%s)"
createdb --maintenance-db=postgres "$RESTORE_DB"
gunzip -c "$BACKUP" | psql -X -v ON_ERROR_STOP=1 -d "$RESTORE_DB"
psql -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" -d "$RESTORE_DB"
# Compare that table count with a separately restored known-good dump; then remove the scratch DB:
dropdb --maintenance-db=postgres "$RESTORE_DB"

# Do not pipe a dump into an existing populated database. `prisma validate` checks schema syntax, not restored data.
# Rehearsed in this worktree: db-20261025.sql.gz restored 87 tables into a scratch DB with no ERROR lines; live nexus was untouched.
```

Also back up `.env` (SECRETS_MASTER_KEY is unrecoverable — losing it
locks every encrypted credential) and `data/moby-session.json`.

## 6. Daily operations

- `pm2 list` — `1ai-tracker-web` online; restart on deploy AFTER `npm run build`
- Refresher self-heals: derivatives 1m, sentiment 5m, backtest 6h,
  brief calibration daily, subscription lifecycle hourly
- Logs: `pm2 logs 1ai-tracker-web --nostream --lines 100`
- Health: `/api/v1/health`, detailed: `/api/v1/health/detailed`

## 7. Known honest limits (not defects)

- IDX BUY emissions gated at alphaScore≥68 (Sept OOS 38.3%/+0.64);
  below-floor scores WAIT by design — volume looks low, that is the edge.
- ConvictionSignal history contains pre-fix flood rows (09-18, 338 dupes);
  dedup is enforced going forward, history kept for audit.
- Fear-greed leg is display-only (greed n=11, fear n=0 in overlap) — cited, never gated.
- Billing is per-30d prepay with expiry enforcement, NOT card auto-charge;
  renewal = customer re-pays via checkout.
- Intel tables (signals, snapshots) are GLOBAL market data, not per-user;
  per-user isolation covers accounts, alerts, keys, watchlists, portfolios.
