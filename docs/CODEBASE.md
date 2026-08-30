# CODEBASE.md — 1ai-tracker (NEXUS)
> Auto-generated codebase memory for AI agents. Last updated: 2026-06-19.

## Purpose
Open-source crypto whale tracker and on-chain intelligence platform. Real-time blockchain analytics for tracking whale movements, smart money flows, and on-chain activity across Ethereum, Solana, Bitcoin, Arbitrum, Base, and Optimism. Zero API keys required — runs on free public RPC endpoints.

## Tech Stack
- **Languages**: TypeScript 5.x
- **Frameworks**: Next.js 16 (App Router), Prisma 6 ORM
- **Key Libraries**: react 19, viem, wagmi, socket.io-client, recharts, d3, zustand, zod, ioredis, shadcn/ui, tailwindcss 4, framer-motion, lightweight-charts

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
npm install && npm run db:push && npm run db:seed
npm run dev                                    # Next.js on :4400
cd ws-server && npm run dev                    # WebSocket on :4401
cd indexer && npm run dev                      # Blockchain indexer

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
