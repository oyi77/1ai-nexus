# NEXUS — Buyer Handover Runbook

Verified 2026-09-22 against HEAD `pending-commit`. Follow in order; every step has
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
npm install
npx prisma migrate deploy   # NEVER db:push on a migrated DB — ledger drift
npm run build
pm2 start ecosystem.config.js --only 1ai-tracker-web
curl -s localhost:4400/api/v1/health | head -c 200
```

Check: health returns 200 with `{ data: { status: "ok" } }`.

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
# Backup (daily cron recommended):
docker compose exec postgres pg_dump -U nexus nexus | gzip > backup_$(date +%Y%m%d).sql.gz
# Restore to a fresh DB:
gunzip -c backup_YYYYMMDD.sql.gz | docker compose exec -T postgres psql -U nexus nexus
# Verify:
npx prisma validate && curl -s localhost:4400/api/v1/health
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
