# NEXUS Operations Runbook

## Prerequisites

| Dependency | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20+ | Runtime for all services |
| PostgreSQL | 16 | Primary database |
| Redis | 7 | Pub/Sub event bus, rate limiting cache |
| npm | 10+ | Package manager |
| Docker | 24+ | Container deployment (optional) |
| Docker Compose | 2.20+ | Multi-service orchestration (optional) |

## Environment Variables

All configuration is via environment variables. Copy `.env.example` to `.env` and customize:

### Core Services

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgresql://nexus:nexus@localhost:5432/nexus` | Yes | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Yes | Redis connection string |
| `NEXTAUTH_SECRET` | `change-me-in-production` | Yes | Session encryption key. **Must** be changed in production. |
| `NEXTAUTH_URL` | `http://localhost:4400` | Yes | Base URL for NextAuth callbacks. Set to `https://tracker.aitradepulse.com` in production. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:4400` | No | Public-facing app URL used by the frontend. |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:4401` | No | WebSocket server URL used by the frontend. |
| `NEXUS_API_KEYS` | *(required — no default)* | Yes | Comma-separated API keys for v1 endpoint auth. |
| `POSTGRES_PASSWORD` | `nexus` | Docker | PostgreSQL password (Docker Compose only). |

### Blockchain RPC Endpoints

All have sensible defaults using free public nodes. Override to use your own infrastructure:

| Variable | Default | Description |
|----------|---------|-------------|
| `ETH_WS_URL` | `wss://ethereum-rpc.publicnode.com` | Ethereum WebSocket RPC |
| `ARB_WS_URL` | `wss://arbitrum-one-rpc.publicnode.com` | Arbitrum WebSocket RPC |
| `BASE_WS_URL` | `wss://base-rpc.publicnode.com` | Base WebSocket RPC |
| `OP_WS_URL` | `wss://optimism-rpc.publicnode.com` | Optimism WebSocket RPC |
| `SOLANA_WS_URL` | `wss://api.mainnet-beta.solana.com` | Solana WebSocket RPC |

### Optional API Keys (Free Tiers)

| Variable | Provider | Free Tier | Enhancement |
|----------|----------|-----------|-------------|
| `ALCHEMY_API_KEY` | Alchemy | 30M CU/month | Token balances, transfers, NFT data, enhanced RPC |
| `HELIUS_API_KEY` | Helius | 100K credits/day | Enriched Solana transactions, DAS API, webhooks |
| `ETHERSCAN_API_KEY` | Etherscan | 5 calls/sec | Ethereum transaction history, gas prices |
| `ARBISCAN_API_KEY` | Arbiscan | 5 calls/sec | Arbitrum transaction history |
| `BASESCAN_API_KEY` | Basescan | 5 calls/sec | Base transaction history |
| `OPTIMISM_ETHERSCAN_API_KEY` | Optimistic Etherscan | 5 calls/sec | Optimism transaction history |
| `BSCSCAN_API_KEY` | BscScan | 5 calls/sec | BSC transaction history |
| `POLYGONSCAN_API_KEY` | PolygonScan | 5 calls/sec | Polygon transaction history |
| `CRYPTOCOMPARE_API_KEY` | CryptoCompare | Free tier | Higher rate limits for news and market data |
| `LUNARCRUSH_API_KEY` | LunarCrush | Free tier | Social sentiment, Galaxy Score, Alt Rank |
| `FRED_API_KEY` | FRED | Free (DEMO_KEY) | Federal Reserve economic data |

### Indexer Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Indexer log verbosity: `debug`, `info`, `warn`, `error` |
| `HEALTH_PORT` | `4409` | Indexer health check HTTP port |

## Deployment

### Docker Compose (Recommended)

The `docker-compose.yml` defines 6 services:

| Service | Port | Description |
|---------|------|-------------|
| `postgres` | 5432 | PostgreSQL 16 with health check |
| `redis` | 6379 | Redis 7 with health check |
| `db-init` | — | One-shot: schema push + seed (runs once, then exits) |
| `web` | 4400 | Next.js 16 application |
| `ws` | 4401 | WebSocket sidecar (Socket.IO) |
| `indexer` | 4409 | Multi-chain blockchain indexer (health check HTTP) |

**Start**:

```bash
# Copy and edit environment
cp .env.example .env
# Edit .env with production values

# Build and start all services
docker compose up -d

# View logs
docker compose logs -f web
docker compose logs -f indexer
docker compose logs -f ws
```

**Stop**:

```bash
docker compose down
```

**Stop and remove volumes** (destroys data):

```bash
docker compose down -v
```

### Manual Deployment

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Seed database (idempotent)
npm run db:seed

# Build
npm run build

# Start web application
npx next start -p 4400

# Start WebSocket server (separate terminal)
cd ws-server && npm install && npm run build && node dist/server.js

# Start indexer (separate terminal)
cd indexer && npm install && npm run build && node dist/main.ts
```

### Dockerfile

The main Dockerfile uses a 3-stage multi-stage build:

1. **deps** — `npm ci` to install dependencies
2. **builder** — `prisma generate` + `npm run build`
3. **runner** — Copies standalone output, runs as non-root `nextjs` user

```bash
docker build -t nexus-web .
docker run -p 4400:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e REDIS_URL="redis://..." \
  -e NEXTAUTH_SECRET="..." \
  nexus-web
```

## Cloudflare Tunnel Setup

The production deployment uses Cloudflare Tunnel to expose the local Docker Compose stack at `tracker.aitradepulse.com`.

### Install cloudflared

```bash
# Debian/Ubuntu
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared
```

### Configure Tunnel

```bash
# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create nexus

# Configure routes
cat > ~/.cloudflared/config.yml << EOF
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: tracker.aitradepulse.com
    service: http://localhost:4400
  - hostname: ws.tracker.aitradepulse.com
    service: http://localhost:4401
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF

# Route DNS
cloudflared tunnel route dns nexus tracker.aitradepulse.com
cloudflared tunnel route dns nexus ws.tracker.aitradepulse.com

# Run tunnel
cloudflared tunnel run nexus
```

### Systemd Service

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

## Health Checks

### Web Application

```bash
curl -s http://localhost:4400/api/v1/data-sources | jq '.data.summary'
```

Expected: `{"total": 17, "available": N, ...}`

### WebSocket Server

```bash
curl -s http://localhost:4401/health
```

Expected: `{"status": "ok", "uptime": 12345}`

### Indexer

```bash
curl -s http://localhost:4409/health
```

Expected: JSON with integration status for each chain and API.

### PostgreSQL

```bash
docker compose exec postgres pg_isready -U nexus
```

Or directly:

```bash
psql postgresql://nexus:nexus@localhost:5432/nexus -c "SELECT 1"
```

### Redis

```bash
docker compose exec redis redis-cli ping
```

Expected: `PONG`

### Full Stack Check

```bash
# Check all services are running
docker compose ps

# Check web app responds
curl -s -H "Authorization: Bearer $NEXUS_API_KEYS" \
  http://localhost:4400/api/v1/data-sources | jq '.data.summary'

# Check indexer health
curl -s http://localhost:4409/health | jq '.integrations'

# Check WebSocket
curl -s http://localhost:4401/health
```

## Monitoring

### Data Sources Status

The `/api/v1/data-sources` endpoint provides real-time health of all 17 integrations:

```bash
curl -s -H "Authorization: Bearer <key>" \
  https://tracker.aitradepulse.com/api/v1/data-sources | jq '.data.summary'
```

Monitor the `coverage` field. If it drops below 70%, investigate which sources are failing.

### Indexer Health

The indexer exposes a health endpoint on port 4409:

```bash
curl -s http://localhost:4409/health
```

The response includes per-integration status (Alchemy, Etherscan, DeFiLlama, etc.) and chain connectivity.

### Docker Compose Logs

```bash
# Follow all logs
docker compose logs -f

# Follow specific service
docker compose logs -f indexer

# Last 100 lines
docker compose logs --tail 100 web

# Logs since timestamp
docker compose logs --since 2026-06-09T00:00:00 indexer
```

### Database Monitoring

```bash
# Check connection count
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity"

# Check table sizes
psql $DATABASE_URL -c "
  SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid))
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
"

# Check indexer checkpoint progress
psql $DATABASE_URL -c "SELECT chain, \"lastBlock\", \"updatedAt\" FROM \"IndexerCheckpoint\" ORDER BY \"updatedAt\" DESC"
```

### Redis Monitoring

```bash
# Check connected clients
docker compose exec redis redis-cli info clients

# Check memory usage
docker compose exec redis redis-cli info memory

# Check Pub/Sub channels
docker compose exec redis redis-cli pubsub channels
```

## Troubleshooting

### Service Won't Start

**Symptom**: Container exits immediately.

```bash
# Check logs
docker compose logs <service>

# Common causes:
# - DATABASE_URL unreachable → ensure postgres is healthy
# - REDIS_URL unreachable → ensure redis is healthy
# - Port conflict → check if port is already in use
lsof -i :4400
lsof -i :4401
lsof -i :4409
```

### Database Connection Refused

**Symptom**: `ECONNREFUSED` errors in web/indexer logs.

```bash
# Check postgres is running
docker compose ps postgres

# Check postgres is accepting connections
docker compose exec postgres pg_isready -U nexus

# If using local postgres (not Docker):
brew services list | grep postgres
sudo systemctl status postgresql
```

### Redis Connection Refused

**Symptom**: Rate limiting fails, WebSocket events stop flowing.

```bash
# Check redis is running
docker compose ps redis

# Test connection
docker compose exec redis redis-cli ping

# If using local redis:
redis-cli ping
```

### Indexer Not Syncing

**Symptom**: No new transactions appearing, stale checkpoint data.

```bash
# Check indexer health
curl -s http://localhost:4409/health

# Check indexer logs for connection errors
docker compose logs indexer | grep -i "error\|disconnect\|retry"

# Check checkpoint progress
psql $DATABASE_URL -c "SELECT chain, \"lastBlock\", \"updatedAt\" FROM \"IndexerCheckpoint\""

# Common causes:
# - RPC endpoint rate limited → switch to a different public node or add Alchemy key
# - WebSocket disconnect → indexer auto-reconnects, check logs for reconnection attempts
# - Redis down → events won't publish, but DB writes continue
```

### API Returns 401

**Symptom**: All v1 endpoints return `{"data": null, "error": "Invalid or missing API key"}`.

```bash
# Verify NEXUS_API_KEYS is set
echo $NEXUS_API_KEYS

# Test with correct header
curl -s -H "Authorization: Bearer $NEXUS_API_KEYS" \
  http://localhost:4400/api/v1/data-sources

# Check middleware logs
docker compose logs web | grep AUTH
```

### API Returns 429

**Symptom**: `{"data": null, "error": "Rate limit exceeded"}`.

- **Middleware per-key rate limit**: 200 req/min per API key (in-memory, resets on restart)
- **Auth endpoint rate limit**: 5 login attempts/min per IP (Redis-backed, fail-closed)
- **Per-plan rate limit**: 100–10,000 req/hr per user session (in-memory, premium routes)
- **Redis-backed route rate limit**: 100 req/min per IP (applied to ~9 routes: entities, tokens, predictions, smart-money, paper-trades)

```bash
# Check remaining limit (Redis-backed routes only)
curl -sI -H "Authorization: Bearer <key>" \
  http://localhost:4400/api/v1/tokens | grep -i X-RateLimit

# If stuck, restart web service to clear in-memory limits
docker compose restart web
```

### Data Sources Showing Unavailable

**Symptom**: `/api/v1/data-sources` shows low coverage.

```bash
# Run the data sources check
curl -s -H "Authorization: Bearer <key>" \
  http://localhost:4400/api/v1/data-sources | jq '.data.sources[] | select(.available == false)'
```

Common fixes:
- **DeFiLlama**: Check https://defillama.com — may be temporarily down.
- **CoinPaprika**: Rate limited. Wait or reduce request frequency.
- **CryptoCompare**: Add `CRYPTOCOMPARE_API_KEY` for higher limits.
- **LunarCrush**: Add `LUNARCRUSH_API_KEY`. Free tier requires signup.
- **Alchemy/Helius/Etherscan**: Add respective API keys.

### WebSocket Not Connecting

**Symptom**: Frontend shows no real-time updates.

```bash
# Test WebSocket health
curl -s http://localhost:4401/health

# Test Socket.IO connection
npx socket.io-cli connect http://localhost:4401 --auth '{"token":"<NEXUS_API_KEYS>"}'

# Check if WS port is exposed
docker compose port ws 4401

# Check nginx/cloudflare proxy settings
# Ensure WebSocket upgrade headers are passed:
#   proxy_set_header Upgrade $http_upgrade;
#   proxy_set_header Connection "upgrade";
```

### Prisma Schema Drift

**Symptom**: `Error: Prisma schema validation` or migration errors.

```bash
# Regenerate Prisma client
npx prisma generate

# Push schema changes (non-destructive)
npx prisma db push

# Check schema diff
npx prisma db push --preview-feature

# Nuclear option: reset database (DESTRUCTIVE)
npx prisma db push --force-reset
npm run db:seed
```

## Rollback Procedure

### Docker Compose Rollback

```bash
# 1. Stop current deployment
docker compose down

# 2. Check out previous version
git log --oneline -10
git checkout <previous-commit>

# 3. Rebuild and restart
docker compose up -d --build

# 4. Verify
curl -s http://localhost:4401/health
curl -s -H "Authorization: Bearer $NEXUS_API_KEYS" \
  http://localhost:4400/api/v1/data-sources | jq '.data.summary'

# 5. Return to latest when ready
git checkout main
docker compose up -d --build
```

### Database Rollback

If a schema change caused issues:

```bash
# 1. Stop services that write to DB
docker compose stop web indexer

# 2. Restore from backup (if available)
pg_restore -d nexus nexus_backup.dump

# 3. Or force-push the previous schema
git checkout <previous-commit> -- prisma/schema.prisma
npx prisma db push --force-reset

# 4. Re-seed
npm run db:seed

# 5. Restart services
docker compose start web indexer
```

### Seed Recovery

The seed script (`prisma/seed.ts`) is idempotent and can be re-run safely:

```bash
npm run db:seed
```

It populates 50 entities, 500 prediction markets, 10,000 trades, and associated wallets/tokens.

## Maintenance

### Database Backups

```bash
# Backup
pg_dump -Fc -f nexus_backup.dump nexus

# Restore
pg_restore -d nexus nexus_backup.dump
```

### Redis Persistence

Redis is configured for AOF persistence by default. Data is stored in the `redis_data` Docker volume.

### Log Rotation

Docker Compose logs are managed by Docker's logging driver. Configure in `docker-compose.yml`:

```yaml
services:
  web:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

### Updating Dependencies

```bash
# Update all dependencies
npm update

# Update specific package
npm update next

# Regenerate lock file
rm package-lock.json && npm install

# Rebuild Docker images
docker compose build --no-cache
```

## Scheduled Tasks & Cron Jobs

The production server runs a user crontab (`crontab -l`) that drives all
background harvesters, scanners, and pipelines. Key entries:

| Schedule | Command | Log | Purpose |
|----------|---------|-----|---------|
| `*/5 * * * *` | `npm run cron:sniper` | `/tmp/sniper-cron.log` | Meme sniper scan (call-feed discovery, GMGN audit, signal delivery) |
| `*/2 * * * *` | `python3 scripts/call-feed.py --limit 25 --window-min 60` | `/tmp/call-feed-cron.err` | Read operator call channels, score token confluence → `data/call-feed-latest.json` |
| `0 */6 * * *` | `npm run cron:caller-scores` | `/tmp/caller-scores-cron.log` | Refresh Telegram Alpha Caller weights from Solpump → `data/caller-scores.json` |
| `*/15 * * * *` | `npm run cron:zero-issue` | `/tmp/nexus-zero-issue.log` | Zero-issue audit sweep + Telegram alerting |
| `*/5 * * * *` | `npm run cron:smart-money-sync` | `/tmp/smart-money-sync.log` | Smart-money wallet sync |
| `0 3 * * *` | `npm run cron:wallet-refresh` | `/tmp/wallet-refresh.log` | Wallet refresh |
| `30 3 * * *` | `npm run harvest:whales` | `/tmp/whale-harvester.log` | Whale harvest |
| `0 4 * * *` | `npm run bootstrap:gmgn` | `/tmp/gmgn-bootstrap.log` | GMGN session bootstrap |
| `*/30 * * * *` | `npm run cron:token-holdings` | `/tmp/token-holdings.log` | Populate TokenHolding from GMGN holder data (cross-token whale context). OFF unless `TOKEN_HOLDINGS_ENABLED="true"`. |
| `*/20 * * * *` | `npm run harvest:crossex` | `/tmp/crossex-harvest.log` | CrossEx funding harvest |
| `0 3 * * *` | `scripts/backup-db.sh` | `/tmp/nexus-db-backup.log` | PostgreSQL backup |
| `17 */6 * * *` | `npm run harvest:idx-universe` | `/tmp/idx-universe-harvest.log` | IDX universe harvest |
| `0 11 * * 1-5` | `npm run harvest:idx-screener` | `/tmp/idx-screener.log` | IDX screener harvest (weekdays) |
| `0 12 * * 1-5` | `npm run cron:alpha-track` | `/tmp/alpha-track-cron.log` | Alpha track (weekdays) |
| `40 10 * * 1-5` | `npm run harvest:idx-saham` | `/tmp/idx-saham-harvest.log` | IDX saham harvest (weekdays) |
| `5/15/19/30/45 19 * * 1-5` | `harvest:idx-ajaib/stockbit`, `track/alert:idx-signals` | various | IDX broker + signal pipeline (weekdays) |
| `20 18 * * 1-5` | `npm run harvest:idx-fundamentals` | `/tmp/idx-fundamentals.log` | IDX fundamentals (weekdays) |
| `17 3 * * *` | `bash scripts/autoresearch.sh` | `logs/autoresearch-bench.log` | Daily autoresearch benchmark (off-peak; avoids wallet-refresh and token-holdings slots) |
| `*/10 * * * *` | `npm run cron:whale-buy-scan` | `/tmp/whale-buy-scan-cron.log` | Whale-buy scan over rotating GMGN candidates; upserts `WalletBuySignal` (source=`whale-buy-scanner`), prunes >6h, folds buyers into `data/whale-wallets-registry.json`, and rewrites both whale tabs on the operator sheet. |
| `*/5 * * * *` | `npm run cron:kol-monitor` | `/tmp/kol-monitor.log` | KOLScan + Axiom smart-money monitor. OFF unless `KOL_MONITOR_ENABLED="true"`; the KOLScan source additionally needs `KOLSCAN_ENABLED="true"`. |
| manual | `npm run cron:whale-sheet-sync` | — | Re-push both whale tabs from DB + registry without running a scan (repair / after a manual DB fix). |

### Whale sheet tabs

Both tabs live on the operator spreadsheet (`SPREADSHEET_ID`, see `smart-money-sync.ts`) and are **full rewrites**, never append logs. Each rewrite is ONE atomic `values:batchUpdate` (Sheets applies all ranges or none), so a killed process can never leave a tab half-empty; stale tail rows are blanked in the same call, and an unchanged payload is skipped entirely (hash in `StateMeta` scope `whale-sheet-sync`), costing zero write quota.

| Tab | Written by | Columns | Semantics |
|---|---|---|---|
| `WhaleScanner` | `whale-buy-scan` step 7 | Contract, Chain, Buyers, Volume USD, Buy Count, First/Last Buy (UTC) | Current candidates only — mirrors the 6h-pruned `WalletBuySignal` window. |
| `WhaleWallets` | `whale-buy-scan` step 8 | Address, Alias, Status, Win Rate %, PnL 30d %, Labels, Times Caught, First/Last Caught (UTC), Tokens | Cumulative registry of every whale wallet the scanner ever caught; `Times Caught` / `Last Caught` show whether it is still active. |

Override names with `WHALE_SCAN_TAB` / `WHALE_WALLET_TAB`; override the registry path with `WHALE_REGISTRY_PATH`. A header-only `WhaleScanner` tab means the scanner ran and found nothing — distinct from a sync that never ran.


> **Conventions**: all cron lines `cd /home/openclaw/projects/1ai-tracker` first,
> prefix `PATH=/home/openclaw/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin`
> for npm/tsx, and append `>> /tmp/<name>.log 2>&1`. Python scripts use the
> system python3 directly (no PATH prefix needed). Edit with:
> `crontab -l > /tmp/crontab.bak && crontab -l | { cat; echo "<line>"; } | crontab -`

### Caller Score Refresh — `cron:caller-scores`

**Script**: `scripts/fetch-caller-scores.py`
**npm script**: `npm run cron:caller-scores`
**Cron**: `0 */6 * * *` (every 6 hours, log: `/tmp/caller-scores-cron.log`)

Fetches Telegram Alpha Caller rankings from the **public keyless** Solpump
endpoint and writes per-caller confluence weights to
`data/caller-scores.json`:

- **Source**: `GET https://trade.solpump.io/api/v2/watchlist/ranking/all?timeframe=30d`
  (paginated via `nextCursor`, max 5 pages, filters `source.type == "CALLER"`,
  drops callers below 20 calls)
- **Output**: `data/caller-scores.json` — top-level keys: `generated_at`,
  `source`, `timeframe`, `caller_count`, `callers`, `callers_by_id`. Each
  caller record: `{id, name, winRatePct, totalCalls, averageMultiplier,
  topBucket, weight}`. Currently 75 callers with weights 0.1051–1.0992.
- **Weight formula**: `winRatePct/100 * (1 + min(averageMultiplier, 1000)/1000)`,
  clamped to `[0.1, 5.0]`
- **Dependencies**: Python 3 stdlib only (no pip packages)
- **Exit codes**: 0 = ok, 1 = partial data (some pages failed), 2 = no data

This artifact feeds the **weighted confluence scoring** in
`scripts/call-feed.py` (see below). It never touches candidate safety gates.

### Call-Feed Pipeline — `scripts/call-feed.py`

**Cron**: `*/2 * * * *` (every 2 min, output: `data/call-feed-latest.json`)

Reads recent messages from 12 operator Telegram call channels via the live
user session (read-only Telethon), extracts contract addresses, and emits
candidate rows ranked by confluence — how many **independent** channels
called the same token.

**Weighted confluence scoring** (upgraded to consume `caller-scores.json`):

- When `data/caller-scores.json` is present, each token mention contributes
  the caller's measured **weight** (win rate × realized multiple, clamped
  0.1–5.0) to a per-token `weighted_score`. The token record also carries a
  `caller_weights` map of `{channel_handle: weight}` for its contributors.
- **Sort order**: `source_count` desc, then `weighted_score` desc (replaces
  raw mention count as the tiebreaker).
- **Backward compatible**: if `data/caller-scores.json` is absent, all
  weights default to 1.0 — the script degrades to the original unweighted
  ranking with no behavior change.
- **Fields in each candidate**: `contract`, `chain`, `sources`,
  `source_count`, `mentions`, `weighted_score`, `caller_weights`,
  `first_seen`, `last_seen`, `kinds`

Channel handle normalization: leading `@` stripped + lowercased for lookup
in `caller-scores.json`. Channels with no matching Solpump caller fall back
to weight 1.0.

> ⚠️ **`data/caller-scores.json` is NOT in `.gitignore`** — it currently
> shows as untracked (`??`) in `git status`. This is a runtime artifact
> regenerated every 6 hours by cron and should not be committed. Add it to
> `.gitignore` before staging (see `data/call-feed-latest.json` pattern at
> line 111 of `.gitignore` for reference).

## Sniper Environment Variables

The Vilona Sniper pipeline (cron `*/5 * * * *`, see `src/scripts/sniper-cron.ts`)
is driven entirely by environment variables. The crontab line already sets
`SNIPER_SCAN_LIMIT`, `SNIPER_DISCOVER_MODE`, and `SNIPER_DELIVER`; the rest
are optional overrides. Every variable below is safe to leave unset — the
defaults keep the pipeline inert (no sale-channel delivery unless a bot token
is staged) and defensive (unproven candidates are always REJECTED).

### Delivery & Chat Targets

| Variable | Type | Default | Purpose | Safety |
|---|---|---|---|---|
| `SNIPER_DELIVER` | boolean (`'false'` disables) | `true` | Master switch for Telegram delivery of actionable tiers during a scan pass. Any value other than `'false'` leaves delivery ON. | When `false`, no signal is ever pushed — useful for dry-run scans. When a bot token is present and this is unset, delivery is live. |
| `SNIPER_DELIVER_WATCHLIST` | boolean (`'true'` enables) | `false` (off) | Whether WATCHLIST candidates are delivered in addition to HIGH_CONVICTION signals. Default OFF keeps the product channel noise-free. | Turning ON floods the sale channel with unconfirmed candidates — only use in a staging/review channel. |
| `SNIPER_TELEGRAM_BOT_TOKEN` | string | empty | Bot token used to push sniper alerts. Falls back to `HUB_TELEGRAM_BOT_TOKEN` then `TELEGRAM_BOT_TOKEN`. | **Secret.** Must never be committed. Without a token, `deliverSniperAlert` is a no-op (returns `false`, never throws). |
| `SNIPER_DELIVER_CHAT_ID` | string | empty | Target chat for delivered signals. Falls back to `HUB_TELEGRAM_OWNER_CHAT_ID` → `TELEGRAM_ALERT_CHAT_ID` → `TELEGRAM_ADMIN_CHAT_ID`. | Points alerts at the sale/operator channel. A wrong ID leaks signals to the wrong audience. |
| `SNIPER_REVIEW_CHAT_ID` | string | empty | Separate chat for the near-miss review digest. Falls back to `HUB_TELEGRAM_OWNER_CHAT_ID` / `TELEGRAM_ADMIN_CHAT_ID` — **never** to the sale channel. | A review digest is never a signal; this separation prevents it from leaking into the product surface. |

### Discovery & Scan Cadence

| Variable | Type | Default | Purpose | Safety |
|---|---|---|---|---|
| `SNIPER_DISCOVER_MODE` | enum: `auto`, `api`, `call-feed`, `wallet`, `confluence` | `auto` | Controls which discovery source(s) feed the scan. `auto` unions API pairs + call-feed + wallet-buys + confluence; the others restrict to one source. | Restricting to a single source narrows coverage but never weakens the safety gates — every candidate still passes the full audit + evaluator. |
| `SNIPER_SCAN_LIMIT` | number | `5` | Maximum candidates evaluated per scan pass. Higher = more RPC/API calls per cron slot. | A value too high for the 5-min window risks overlapping cron runs; the process is single-pass and stateless, but API rate limits may trigger. |
| `SNIPER_DISCOVER_API_CANDIDATES` | number | (internal default) | Caps the number of fresh API (dexscreener/gecko) candidates fetched before union with other sources. | Bounds upstream API cost; does not affect gate strictness. |
| `SNIPER_SCAN_CONCURRENCY` | number | (internal default) | Per-pass audit fan-out concurrency across rugcheck/birdeye/gmgn sources. | Higher concurrency speeds the pass but may trip per-source rate limits. Sources are individually isolated — one failure never blocks the others. |

### Dev-History Gate

| Variable | Type | Default | Purpose | Safety |
|---|---|---|---|---|
| `SNIPER_DELIVER_DEV_HISTORY_FAIL` | boolean | (off) | When the dev-history lookup fails (endpoint outage), this controls whether the candidate is still deliverable. Default behavior is to treat an unreachable verdict as UNPROVEN (not a pass). | Leaving off is the safe default: an endpoint outage must never open a hole for a serial rugger. |
| `SNIPER_DEV_HISTORY_GATE` | boolean (`'true'` enables) | `false` (off) | Opt-in anti-rug gate. When ON, each candidate's deployer history is fetched (solpump dev-tokens endpoint) and a SERIAL_RUGGER verdict forces REJECT. | OFF keeps the pipeline byte-for-byte identical to pre-gate behavior. The lookup is memoized per-contract for 30 min (max 500 entries). |
| `SNIPER_TRACE_WALLETS` | boolean (`'false'` disables) | `true` (on) | Whether on-chain buyer tracing runs when the DB has no smart-money evidence. Setting `'false'` restricts evidence to the DB only. | Disabling tracing reduces RPC cost but may leave a candidate unconfirmed (WATCHLIST) instead of SIGNAL — a conservative outcome, never a false positive. |

### Realtime Bridge (opt-in firehose)

| Variable | Type | Default | Purpose | Safety |
|---|---|---|---|---|
| `SNIPER_REALTIME_ENABLED` | boolean (`'true'` enables) | `false` (off) | Master switch for the realtime WebSocket token bridge. Inert until flipped. | Default OFF. When ON, three guards (rate limit, per-contract cooldown, seen-state) prevent a live firehose from becoming spam. |
| `SNIPER_REALTIME_MAX_EVENTS_PER_MIN` | number | `4` | Sliding-window rate limit for realtime events. Over-limit events are DROPPED, never queued. | Lower = quieter. A stale hype event is worthless minutes later, so dropping is correct. |
| `SNIPER_REALTIME_COOLDOWN_MS` | number | `900000` (15 min) | Per-contract cooldown enforced through the pipeline's seen-state. | Prevents the same contract from re-firing within the window. |

### Tuning & Persistence Paths

| Variable | Type | Default | Purpose | Safety |
|---|---|---|---|---|
| `SNIPER_STALE_AFTER_MINUTES` | number | `120` | A candidate older than this (by pool age) is considered stale and filtered before evaluation. | Tightening raises the floor for "fresh" but never weakens the evaluator. |
| `SNIPER_SEEN_TTL_MS` | number | `3600000` (1 h) | TTL for the per-contract seen-state that prevents repeat deliveries. | Shorter TTL = more re-deliveries of the same contract; the evaluator still screens every one. |
| `SNIPER_REVIEW_VOLMC_FLOOR` | number | `0.5` | Minimum volume/market-cap ratio for a candidate to appear in the review digest. | Only affects the review channel, never the sale channel. |
| `SNIPER_REVIEW_SEEN_TTL_MS` | number | `21600000` (6 h) | TTL for review-digest dedup (one near-miss per contract per window). | Bounds review noise; does not affect signal delivery. |
| `SNIPER_DELIVERY_COOLDOWN_MS` | number | `0` (off) | Optional per-contract delivery cooldown in the delivery log. `0` = no cooldown (the seen-state already dedupes). | A non-zero value adds a second layer of suppression — safe, only more conservative. |
| `SNIPER_MIN_MARKET_CAP_USD` | number | `5000` | Pre-filter floor: candidates below this market cap are dropped before audit. | Raising the floor only removes smaller (riskier) candidates. |
| `SNIPER_MIN_LIQUIDITY_USD` | number | `2000` | Pre-filter floor: candidates below this liquidity are dropped before audit. | Same — a conservative tightening. |
| `SNIPER_ADAPTIVE_POLICY` | boolean (`'true'` enables) | `false` (off) | When ON, tier thresholds adapt to measured outcome hit-rates from prior signals. | Default OFF. Uses pre-existing outcome history so adaptation reflects real evidence, not the current pass. |
| `SNIPER_ADAPTIVE_POLICY_DRY_RUN` | boolean (`'true'` enables) | `false` (off) | Logs what the adaptive policy *would* do without applying it. | Safe observability mode — never mutates delivery. |
| `SNIPER_TRENCHES_DISCOVERY` | boolean (`'true'` enables) | `false` (off) | Additive trenches source (bonding-curve sweet-spot rows). Requires `SOLPUMP_TRENCHES_ENABLED=true` as well. | Additive only — overlaps merge into one candidate; never bypasses the gates. |

### DB Kill-Switches (JSON fallback)

These switch a given store from PostgreSQL (primary) to JSON-file-only. They
exist for hermetic test isolation and emergency DB-outage fallback. In
production they should remain **unset** (DB-primary). Setting any to `off`,
`false`, or `0` bypasses Prisma and reads/writes the JSON file only.

| Variable | Default (unset) | JSON fallback path |
|---|---|---|
| `SNIPER_SEEN_DB` | DB-primary | `data/sniper-seen.json` (or `SNIPER_SEEN_PATH`) |
| `SNIPER_DELIVERY_DB` | DB-primary | `data/sniper-delivery-log.json` (or `SNIPER_DELIVERY_LOG_PATH`) |
| `SNIPER_PHASE_DB` | DB-primary | `data/sniper-phase.json` (or `SNIPER_PHASE_PATH`) |

### File-Path Overrides (all default to `data/` under `cwd`)

| Variable | Default |
|---|---|
| `SNIPER_SEEN_PATH` | `data/sniper-seen.json` |
| `SNIPER_REVIEW_SEEN_PATH` | `data/sniper-review-seen.json` |
| `SNIPER_DELIVERY_LOG_PATH` | `data/sniper-delivery-log.json` |
| `SNIPER_PHASE_PATH` | `data/sniper-phase.json` |
| `SNIPER_AUDIT_PATH` | `data/sniper-audit.json` |
| `SNIPER_LOG_PATH` | `data/sniper-log.json` |
