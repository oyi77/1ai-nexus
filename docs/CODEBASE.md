# CODEBASE.md — 1ai-tracker (NEXUS)
> Auto-generated codebase memory for AI agents. Last updated: 2026-06-19.

## Purpose
Open-source crypto whale tracker and on-chain intelligence platform. Real-time blockchain analytics for tracking whale movements, smart money flows, and on-chain activity across Ethereum, Solana, Bitcoin, Arbitrum, Base, and Optimism. Zero API keys required — runs on free public RPC endpoints.

## Tech Stack
- **Languages**: TypeScript 5.x
- **Frameworks**: Next.js 16 (App Router), Prisma 6 ORM
- **Key Libraries**: react 19, viem, wagmi, socket.io-client, recharts, d3, zustand, zod, ioredis, shadcn/ui, tailwindcss 4, framer-motion, lightweight-charts

## Quick Start

See `README.md` for required secrets and the nine-service Docker stack. For local development, stage `vendor/1ai-payment-0.1.0.tgz` at `../1ai-payment/packages/sdk/`, run `npm ci`, then `npx prisma migrate deploy`. `npm run db:seed` is optional synthetic demo data for a fresh empty development database only; it is neither idempotent nor production recovery. Runtime is screening/research-only (`SHADOW`/`PAPER`), with no live execution path.

## Entry Points
- **Web App**: `src/app/` → Next.js 16 on port 4400
- **Indexer**: `indexer/main.ts` → multi-chain blockchain indexer sidecar
- **WebSocket**: `ws-server/server.ts` → Socket.io real-time sidecar on port 4401
- **MCP Server**: `mcp-server/index.ts` → Model Context Protocol server

## Directory Structure
```
src/
  app/              Next.js App Router pages (dashboard, entities, smart-money, flows, predictions, tokens, alerts, api/)
  components/       React components (domain, entity, predictions, ui)
  lib/              Shared utilities: alerts engine, API middleware, events, WebSocket client, data modules
    modules/        Data fetchers: onchain, equities, commodities, macro, sentiment, news, prediction, ai-signals
    cex/            CEX exchange adapters with rate limiting and caching
    alerts/         Alert evaluator and webhook delivery
    api/            Auth, rate-limit, validation middleware
indexer/            Blockchain indexer (separate process)
  chains/           ethereum.ts, solana.ts, bitcoin.ts listeners
  processors/       Transaction decoding & smart money detection
  integrations/     CEX, DeFiLlama, Etherscan, Alchemy, Jupiter, Helius
ws-server/          WebSocket sidecar (Socket.io + Redis Pub/Sub)
prisma/             schema.prisma (12 models), seed.ts
packages/           core (shared), sdk-python (Python SDK)
db/                 ClickHouse init scripts
docs/               Architecture, API docs, ops runbook, CEX architecture
```

## Key Files
| File | Purpose |
|------|---------|
| `indexer/main.ts` | Indexer entry — starts chain listeners + background sync |
| `indexer/chains/ethereum.ts` | ETH/ARB/BASE/OP via eth_subscribe |
| `indexer/chains/solana.ts` | Solana WebSocket subscription |
| `indexer/chains/bitcoin.ts` | Bitcoin REST polling (Blockstream) |
| `ws-server/server.ts` | Socket.io WebSocket server |
| `ws-server/subscriber.ts` | Redis event subscriber → client broadcast |
| `prisma/schema.prisma` | Database schema: 12 models (Entity, Wallet, Trade, Flow, Signal, etc.) |
| `src/lib/technical-analysis.ts` | Technical analysis engine |
| `src/lib/tradebot-bridge.ts` | Trade bot integration bridge |
| `src/lib/cex/client.ts` | CEX exchange client with rate limiting |

## Architecture
```
┌─────────────────────────────────────────────────────────┐
│  Next.js 16 (:4400)  │  WS Sidecar (:4401)  │  Indexer  │
├───────────────────────┴──────────────────────┴──────────┤
│                    Redis Pub/Sub                         │
├─────────────────────────────────────────────────────────┤
│                    Prisma 6 ORM                          │
├─────────────────────────────────────────────────────────┤
│              PostgreSQL 16 + Redis 7                     │
└─────────────────────────────────────────────────────────┘
```
Indexer subscribes to blockchain WebSocket feeds → decodes transactions → publishes to Redis → WS sidecar broadcasts to connected clients. Next.js serves the dashboard and REST API.

## Run Commands
```bash
# Docker (recommended)
docker compose up --build

# Local dev
mkdir -p ../1ai-payment/packages/sdk
cp vendor/1ai-payment-0.1.0.tgz ../1ai-payment/packages/sdk/  # exact lockfile path
npm ci
npx prisma migrate deploy                      # NEVER db:push on a migrated DB
# Optional synthetic demo data: fresh empty development DB only.
# npm run db:seed
npm run dev                                    # Next.js on :4400
# Sidecars in separate terminals:
cd ws-server && npm ci && npm run dev           # WebSocket on :4401
cd indexer && npm ci && npm run dev             # Blockchain indexer on :4409

# Testing & linting
npm run test                                   # vitest
npm run lint                                   # eslint
```

## Environment Variables
Key vars from `.env.example`:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection
- `NEXTAUTH_SECRET`, `NEXUS_API_KEYS` — auth
- `ETH_WS_URL`, `SOLANA_WS_URL` — RPC endpoints (free defaults)
- `ALCHEMY_API_KEY`, `HELIUS_API_KEY`, `ETHERSCAN_API_KEY` — optional enhanced APIs
- `LOG_LEVEL` — indexer verbosity
