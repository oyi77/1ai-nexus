# Codebase Audit — 2026-06-24

## Stack
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS
- **Backend:** Next.js API Routes, Prisma ORM, PostgreSQL 16, Redis (ioredis)
- **Real-time:** Socket.IO (nexus-ws on port 4401), WebSocket streams
- **Indexer:** Custom TypeScript indexer (ETH/ARB/BASE/OP/SOL/BTC)
- **Process Manager:** PM2 (nexus-web:4400, nexus-ws:4401, nexus-indexer:4409)
- **Testing:** Vitest (184 tests, 20 test files)
- **Key Libraries:** lightweight-charts, recharts, d3-force/d3-selection/d3-zoom, lucide-react

## Directory Structure
```
src/
├── app/                    # Next.js App Router pages (40+ pages)
│   ├── api/v1/            # REST API routes (60+ endpoints)
│   ├── dashboard/         # Command Center (main page)
│   ├── trading/           # Consolidated Trading Hub (4 tabs)
│   ├── defi-hub/          # Consolidated DeFi Hub (4 tabs)
│   ├── onchain/           # Consolidated On-Chain Hub (5 tabs)
│   ├── macro-hub/         # Consolidated Macro Hub (4 tabs)
│   ├── analytics/         # Consolidated Analytics Hub (3 tabs)
│   └── [standalone pages] # 17 standalone pages
├── components/
│   ├── layout/            # NexusLayout, TickerStrip, Sidebar
│   ├── features/          # EntityGraph, FearGreedGauge, LiveTerminalFeed, CandlestickChart
│   ├── primitives/        # PriceTag, DeltaBadge, LiveDot, AddressChip
│   └── shell/             # Panel, DataTable
├── lib/
│   ├── modules/           # Data modules (registry pattern)
│   │   ├── market/        # trade-aggregator, orderbook-ws, arbitrage-engine
│   │   ├── derived/       # alpha-engine, paper-trader, insider-detector, mev-detector
│   │   ├── onchain/       # hyperliquid-dex, blockscout, etherscan
│   │   └── news/          # rss-engine (139 feeds)
│   ├── api/               # server-cache, response helpers, rate-limit
│   └── db/                # Prisma client
├── middleware.ts           # Auth, rate limiting, CORS
└── indexer/               # Standalone indexer process
    ├── chains/            # ethereum.ts, solana.ts, bitcoin.ts
    ├── processors/        # transaction.ts, smart-money.ts
    └── streams/           # redis-streams.ts
```

## Static Analysis
- **Dead code:** Minimal — most modules are actively used
- **Tech debt:** Some old pages still use legacy styles (bg-bg-deep vs bg-bg-panel)
- **Code smells:** `as unknown as Column<Record<string, unknown>>[]` casts in DataTable usage

## Test Coverage
- **Current:** 184 tests, 20 test files
- **Critical paths without tests:** API routes (no integration tests), WebSocket streams, indexer

## Performance
- **Server-side cache:** getCached with single-flight dedup (memory + Redis)
- **Rate limiting:** 300 req/min public, 200 req/min API key
- **WebSocket:** Order book depth via Binance WS → nexus-ws → browser (sub-second)
- **Trade aggregation:** 8 exchange WebSockets connected simultaneously

## Security
- **Auth:** Bearer token for API key routes, public routes have rate limiting
- **Secrets:** All in .env (gitignored), zero hardcoded
- **SSRF:** All external fetches have AbortSignal.timeout
- **Input validation:** Zod schemas where used, manual validation elsewhere

## Architecture Score
| Dimension | Score | Notes |
|-----------|-------|-------|
| Scalability | 🟡 | PM2 cluster + Redis, but single-process indexer |
| Maintainability | 🟢 | Clean separation, good module structure |
| Extensibility | 🟢 | Registry pattern for data modules, easy to add sources |
| Observability | 🟡 | PM2 logs, /api/v1/status/cache, but no structured logging |
| Security | 🟢 | Zero API keys, rate limiting, no hardcoded secrets |

## Quick Wins (High impact, low effort — do now)
1. Add integration tests for critical API routes
2. Add structured logging (pino/winston) for production debugging

## Scheduled Improvements (High impact, high effort — roadmap)
1. Token God Mode (P0) — on-chain holder analysis
2. Multi-chain entity labeling expansion
3. Real-time copy trading alerts
