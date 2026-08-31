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
