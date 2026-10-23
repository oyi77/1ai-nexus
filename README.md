# NEXUS — Open-Source Finance Intelligence Platform

Real-time market intelligence across **crypto, macro, forex, commodities, global equities, and options**. NEXUS combines blockchain analytics, macroeconomic data, exchange rates, commodity futures, global stock quotes, and derivatives data into one terminal-style platform that runs primarily on free public APIs.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](docker-compose.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](tsconfig.json)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](package.json)

---

## What is NEXUS?

NEXUS is an **open-source finance intelligence platform** for traders, analysts, desks, and researchers who need cross-asset visibility without stitching together half a dozen terminals. It still includes the original crypto intelligence stack (whales, smart money, entities, memecoin scanner), but now also ships real macro calendars, FRED indicators, forex rates, commodities, global equities, and live Deribit options chains.

### Key Capabilities

- **Cross-Asset Terminal** — Compare crypto, forex, commodities, indices, and macro indicators in one dashboard
- **Macro Intelligence** — FRED-backed rates, inflation, employment, growth, yield curve, and a real economic calendar
- **Forex Monitoring** — Major FX pairs with IDR priority and TradFi alert support
- **Commodities Dashboard** — Precious metals, energy, agriculture, industrial metals, and livestock futures
- **Global Equities** — Major stocks across US, Europe, Asia, Australia, Singapore, Canada, India, Korea, Taiwan, Brazil, and IDX
- **Real Options Chain** — BTC/ETH Deribit options with bid/ask, IV, Greeks, OI, and expiry tabs
- **Structured Alerts** — Price threshold, forex rate, macro event, whale, smart money, and prediction alerts
- **Whale Wallet Tracking** — Monitor large holders across 6 blockchain networks
- **Smart Money Detection** — AI-powered scoring identifies accumulation, distribution, and exit patterns
- **Entity Mapping** — Connect wallets to known entities (exchanges, funds, protocols, whales)
- **DeFi Protocol Analytics** — Track TVL, yields, protocol revenue, and sector dominance
- **Meme Token Detection** — Real-time Pump.fun / Raydium token creation with hype scoring engine
- **DEX Sniper Scanner** — `/scanner` page with sub-second WebSocket updates showing new liquidity pools with risk scoring
- **Strategy-Gated Accumulation Alerts** — Whale accumulation only fires when one of three entry playbooks actually triggers (Second Wave, Level Flip, Whale Comeback) on real MC history, with a ladder plan and a named rule for every refusal
- **Measured Wallet Discovery** — Rebuilds the tracked pool from GMGN leaderboard sweeps, holders of established (MC ≥ $1M) tokens, holders of contracts the call-feed flagged (`called-contracts`), and replayed `TokenHolding` rows of $1M+ tokens (`persisted-holdings` — the established leg is structurally empty because GMGN's `/holders` serves pump.fun-origin mints only). Each leg reports its own admission count, so a high-cap sweep can never claim the call-feed's results. No wallet enters unless it clears the HUMAN check (fastTxRatio, sells > 0, ≥ 10 trades) and GMGN's own bundler/sniper/fresh/transfer-in flags
- **Measured Signal Outcomes** — Every delivered sniper signal is scored on its own horizon: TARGET at +100%, STOPPED at −50%, FLAT inside the ±10% noise band, and WIN/LOSS for real moves outside it. Hit rate counts targets only; win rate counts every decided direction. PENDING and UNPRICEABLE are reported separately and never counted as misses
- **Tier Calibration** — Per-tier hit rates turn into delivery demotions once a tier has `minScored` (default 5) scored signals below `SNIPER_CALIBRATION_FLOOR_PCT` (default 50). Off by default; `SNIPER_ADAPTIVE_POLICY_DRY_RUN=true` logs the verdict without touching delivery
- **Self-Refreshing Insight Brief** — Cross-domain transmission legs (perps funding crowding, IDX foreign flow, sector rotation, fear/greed) cite a measured sample or say so. Funding-unwind cells recompute daily from `DerivativesSnapshot` and replace a baked backtest cell only once the live cell clears `n ≥ 20`; a leg backed by the baked cell is stamped with that cell's own sample date, never today's, and the regime counts proven legs only
- **Call-Group Confluence Gate** — A candidate can be required to have been called by N independent groups, where each group is weighted by how often it *originates* a call rather than re-broadcasts one. Counts are groups, never messages. The feed reports readability separately from emptiness: `readOk:false` (source threw, artifact dead/expired) surfaces as "call-feed unreadable" and never as "nobody called it", because those two have opposite fixes. A per-contract tri-state keeps the reason unambiguous: `available:false` (the source could not be read), `available:true, present:false` (the feed answered and no group called this contract), and `present:true` (groups named, with weighted votes). Only the first is an outage; the second is a measurement.
- **Dev-History Gate** — Rejects a token whose developer has repeatedly shipped nothing that migrates, and now refuses to judge what it cannot yet measure: tokens younger than `matureMinAgeSeconds` (default 1h) are set aside from the migration math instead of being counted as failed migrations, and a token whose `migrated` field upstream never reported is excluded from the judged sample rather than read as "did not migrate". Every verdict carries `previousTokens`, `matureTokens`, `knownMigrations`, and `migrationRate`, so a rejection names the sample it was earned on (`SUSPECT … across 2 mature deploys with a reported outcome (out of 3 total)`) instead of implying all three failed. `0` judged tokens is UNPROVEN, never CLEAN

---

## Information Architecture

The shell is an **OPERATE / MONITOR surface**: dense, left-aligned, no hero sections, no marketing copy. Navigation lives in `src/lib/config/nav.ts` as a single typed structure — changing the source file is the only way to change the sidebar, so routes and nav can never drift apart.

Eight collapsible sections, 108 unique destinations, zero duplicate `href` and zero duplicate React `key` (enforced by `src/lib/config/__tests__/nav.test.ts`).

| Section | Purpose | Representative entries |
|---|---|---|
| Dashboard | Command center, holdings, operator state | `/dashboard`, `/watchlist`, `/alerts`, `/account`, `/following`, `/portfolio`, `/pnl`, `/status` |
| Signals | One Signals hub with tabs instead of parallel top-level pages | `/signals` (`?tab=conviction`, `?tab=alpha`), `/intelligence/leaderboard`, `/composite-alerts`, `/market-score`, `/fear-greed` |
| Markets | Cross-asset market terminal with hubs per asset class | `/markets`, `/screener`, `/saham` (`?tab=signals`, `?tab=ideas`, `?tab=bandar`), `/derivatives`, `/options`, `/etf`, `/heatmap`, `/compare` |
| On-Chain | Wallets, flows, DEX activity, safety | `/onchain`, `/smart-money`, `/whale-cluster`, `/top-traders`, `/copy-trading`, `/exchange-flow`, `/dex` |
| Meme | Sniper pipeline, risk scoring, moonshot board | `/meme`, `/meme/sniper`, `/meme/risk` (`?engine=rugcheck`), `/moonshot`, `/tokens/discover` |
| Macro | Rates, curve, sentiment | `/macro`, `/bonds`, `/forex`, `/commodities` |
| Forecasts | Forecast Hub with one tab per surface, plus valuation models | `/predictions` (`?tab=markets`, `?tab=paper`, `?tab=tape`, `?tab=board`), `/dcf`, `/comps`, `/financials`, `/historical-financials` |
| Research | Docs, widget, developer surface | `/api-docs`, `/widget`, `/entities`, `/graph` |

Design rules for this shell:

- **Tabs over parallel pages.** `/signals` absorbs what used to be four sibling signal pages, `/saham` absorbs the former `/saham-signals`, `/saham-ideas` and `/bandarmology`, `/predictions` absorbs `/prediction-markets` plus `/predictions/paper`, `/predictions/tape` and `/predictions/leaderboard`, and `/meme/risk` absorbed `/rugcheck` as its `rugcheck` engine. Each tab is a distinct data mode, never a marketing variant of the same table. Surviving routes are a hard invariant: every inbound link (`src/app/sitemap.ts`, `/markets`, `/signals`, `/moonshot`, `/dashboard`, `/landing`, `/analytics`) and every nav entry points at a route directory that exists, and dead `src/app` directories are deleted in the same change that redirects their callers.
- **Hubs over one-page-per-source.** `/markets` and `/saham` aggregate sibling data sources behind one route with internal tabs.
- **Every destination is a real surface.** No placeholder routes; a page with no data renders its degradation state (for example `/api/v1/saham/signals` returns `503 No IDX snapshot yet — run the nightly harvests`) rather than a blank frame.
- **No emoji in headings.** Iconography is inline SVG or a text label; the accent colour token carries the visual signal.
- **A `useSearchParams()` client component needs a `Suspense` boundary, and that boundary never uses `fallback={null}`.** Next 16 fails the build for an unwrapped `useSearchParams()`; any boundary satisfying that check is accepted, including one in `page.tsx`. What it does not fix is what the operator sees: a boundary that never resolves with a `null` fallback emits no console error and requests no failed chunk, so it is indistinguishable from a blank page and must be diagnosed by its own symptom. Shape used here (`/meme/risk`): `page.tsx` is a thin server component and `content.tsx` is the `"use client"` module that renders `<Suspense fallback={visible tokens}>` around an inner `*Panel` which owns the hook — fallback and suspended code live in one module and cannot drift apart.
- **Exactly one component renders the shell.** `src/app/layout.tsx` renders providers only (`CsrfProvider` / `ErrorBoundary` / `UserProvider`); no route group under `src/app` mounts `NexusLayout` from a `layout.tsx`, so each `page.tsx` wraps itself exactly once. A layout that wraps while its children also wrap produces a second nav, header and ticker strip — that is why `src/app/meme/layout.tsx` was removed, the five `/meme/*` routes carry the wrapper themselves, and `/predictions` lost its sub-nav layout when the Forecast Hub tab strip took over. Guards: any route reports exactly one `nav[aria-label="Main navigation"]` and one `header`, and leaves no `[aria-busy="true"]` after hydration. Adding a shared layout later is a refactor of all its children in the same commit, never an additive change.
- **An unmeasured field stays null all the way to the alert text.** `evaluateSniper` normalizes every incoming metric through `pctOrNull`, and the formatter gives null its own reading: an LP leg no source measured renders `LP burn n/a + lock 60.00% ❓` and caps the verdict at WATCHLIST, never `0.00% 🔴`; `100% BURNT` and `100% LOCKED` require that leg itself to be measured, so a coalesced `null ?? 0` can no longer claim a burn nobody proved; the launch cohort is judged on its own EXIT fact and nothing else — `bundlerSoldPercent` at 100 passes, below 100 rejects as `Launch cohort still holds X% (sold Y%, needs 100%)`, and `null` rejects as `Launch cohort exit unproven — share and exit both unreported`, never as `sold 0%`. No bundler-SHARE leg exists at all: GMGN reports the cohort's exit ratio and no supply share, and Birdeye's `bundler.percentage` is a wallet count, so a share gate could only ever fail. A genuinely measured zero (a dead token with `volume.m5 = 0`) stays zero — that distinction is the contract, and `meme-sniper.test.ts` pins both sides. Reasons reach the operator through `rejectionId()`, which translates the `n hard-rule breaches — ` prefix by re-entering itself on the first breach, so a count never hides an English reason.


---

## Supported Blockchains

| Chain | Type | Endpoint | API Key |
|-------|------|----------|---------|
| Ethereum | WebSocket | `wss://ethereum-rpc.publicnode.com` | Free |
| Arbitrum | WebSocket | `wss://arbitrum-one-rpc.publicnode.com` | Free |
| Base | WebSocket | `wss://base-rpc.publicnode.com` | Free |
| Optimism | WebSocket | `wss://optimism-rpc.publicnode.com` | Free |
| Solana | WebSocket | `wss://api.mainnet-beta.solana.com` | Free |
| Bitcoin | REST Polling | `https://blockstream.info/api` | Free |

### Optional Enhanced APIs (Free Tiers)

| Provider | Use Case | Free Tier | API Key |
|----------|----------|-----------|---------|
| [Alchemy](https://alchemy.com) | Token balances, transfers, NFT data, enhanced RPC | 30M CU/month | Optional |
| [DeFiLlama](https://defillama.com) | TVL, yields, DEX volumes, stablecoins | Unlimited | Not needed |
| [Etherscan](https://etherscan.io) | Transaction history, gas prices, contract data | 5 calls/sec | Optional |
| [Helius](https://helius.dev) | Enriched Solana txs, DAS API, webhooks | 100K credits/day | Optional |
| [Jupiter](https://jup.ag) | Solana token pricing | Unlimited | Not needed |
| [CoinGecko](https://coingecko.com) | Market data, prices | 10-30 calls/min | Not needed |
| [DexScreener](https://dexscreener.com) | DEX pair data | 300 calls/min | Not needed |
| [Polymarket](https://polymarket.com) | Prediction market data | Unlimited | Not needed |
---

## Quick Start

### Docker Compose (Recommended)

One command starts everything — PostgreSQL, Redis, database seeding, Next.js app, WebSocket server, and blockchain indexer:

```bash
git clone https://github.com/oyi77/1ai-nexus.git
cd 1ai-tracker
cp .env.example .env  # fill REQUIRED first — see docs/HANDOVER.md
docker compose up --build
```

This boots 5 services:

| Service | Port | Description |
|---------|------|-------------|
| `postgres` | 5432 | PostgreSQL 16 database |
| `redis` | 6379 | Redis Pub/Sub event bus |
| `db-init` | — | Runs once: `prisma migrate deploy` against Postgres |
| `web` | 4400 | Next.js 16 application |
| `ws` | 4401 | WebSocket sidecar (Socket.io) |
| `indexer` | — | Multi-chain blockchain indexer |

Open [http://localhost:4400](http://localhost:4400) — sign up, then promote yourself to admin in psql (docs/HANDOVER.md §3).

**Production**: [https://tracker.aitradepulse.com](https://tracker.aitradepulse.com)

### Local Development

```bash
# Prerequisites: Node.js 20+, PostgreSQL 16, Redis 7
brew services start postgresql@16
docker-compose up -d redis

# Install and setup
npm install
npx prisma migrate deploy  # NEVER db:push on a migrated DB
npm run db:seed

# Run
npm run dev          # Next.js on :4400
cd ws-server && npm run dev  # WebSocket on :4401
cd indexer && npm run dev    # Blockchain indexer
```

---

## Self-Host Guide

### Minimum Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4GB | 8GB |
| Disk | 20GB | 50GB |
| OS | Linux (Ubuntu 22.04+) | Any Docker-compatible |
| Docker | 20.10+ | Latest |
| Docker Compose | 2.0+ | Latest |

### Step-by-Step Deployment

```bash
git clone https://github.com/oyi77/1ai-nexus.git
cd 1ai-tracker
cp .env.example .env
sed -i "s/NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env
sed -i "s/NEXUS_API_KEYS=.*/NEXUS_API_KEYS=$(openssl rand -hex 32)/" .env
docker compose up -d --build
curl http://localhost:4400/api/v1/health
```

### Optional: Telegram Alerts

```bash
# Create bot via @BotFather, then:
echo "TELEGRAM_BOT_TOKEN=your-token" >> .env
docker compose restart web
```

### Backup

```bash
docker compose exec postgres pg_dump -U nexus nexus | gzip > backup_$(date +%Y%m%d).sql.gz  # restore: see docs/HANDOVER.md §5
```

### Cost: ~$5/month (VPS only, all APIs free)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NEXUS Platform                        │
├──────────────┬──────────────┬───────────────────────────┤
│  Next.js 16  │  WS Sidecar  │    Blockchain Indexer     │
│  (Port 4400) │  (Port 4401) │    (ETH/SOL/BTC/ARB/OP)  │
├──────────────┴──────────────┴───────────────────────────┤
│                    Redis Pub/Sub                         │
├─────────────────────────────────────────────────────────┤
│                    Prisma 6 ORM                          │
├─────────────────────────────────────────────────────────┤
│              PostgreSQL 16 + Redis 7                     │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Recharts, Socket.io-client
- **Backend**: Next.js API Routes, Prisma 6 ORM, Zod validation
- **Real-Time**: Socket.io WebSocket sidecar, Redis Pub/Sub event bus
- **Blockchain**: Standard JSON-RPC subscriptions (`eth_subscribe`), Solana WebSocket API, Bitcoin REST polling, Alchemy Enhanced APIs, DeFiLlama, Etherscan, Helius, Jupiter
- **Database**: PostgreSQL 16, Redis 7
- **Auth**: NextAuth.js with credentials provider
- **Infrastructure**: Docker Compose, multi-stage builds

---

## API Documentation

### REST API (v1)

All endpoints use the standard `{ data, meta, error }` envelope.

```
GET  /api/v1/alerts            — User alert configurations
POST /api/v1/alerts            — Create structured alert
PATCH /api/v1/alerts           — Toggle alert enabled/disabled
DELETE /api/v1/alerts?id=...   — Delete alert
GET  /api/v1/alerts/evaluate   — Evaluate active alerts against live data

GET  /api/v1/fear-greed        — Composite fear & greed with history
GET  /api/v1/macro             — FRED / Treasury / World Bank macro indicators
GET  /api/v1/calendar          — FRED release calendar + central bank schedules
GET  /api/v1/indonesia-macro   — Indonesia macro indicators + BI rate
GET  /api/v1/global-macro      — Multi-country macro snapshot
GET  /api/v1/forex             — FX rates (dedicated backend route)
GET  /api/v1/commodities       — Commodity futures snapshot by category
GET  /api/v1/equities          — Global equities and major indices
GET  /api/v1/correlations      — Cross-asset correlations
GET  /api/v1/gaps              — Cross-venue dislocations and kimchi premium
GET  /api/v1/stablecoins       — Stablecoin peg monitor

GET  /api/v1/market/prices     — Core crypto market snapshot
GET  /api/v1/news              — News feed
GET  /api/v1/flows             — Capital flow data
GET  /api/v1/smart-money       — Smart money signals and scores
GET  /api/v1/predictions       — Prediction market data
GET  /api/v1/defi/overview     — DeFi TVL / yields / fees overview
GET  /api/v1/revenue           — Protocol revenue snapshot
GET  /api/v1/yields            — Yield pools
GET  /api/v1/status            — Infra + data source health
GET  /api/v1/modules/fetch     — Generic module passthrough (internal/debug use)
```

### WebSocket Events

Connect to `ws://localhost:4401` with Bearer token (auth-protected namespaces require it; public namespaces don't):

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:4401", {
  auth: { token: "your-api-key" }
});

// Real-time trade events
socket.on("trade", (data) => {
  console.log(`${data.chain}: ${data.from} → ${data.to}`);
});

// Smart money signals
socket.on("smart-money", (signal) => {
  console.log(`${signal.type}: ${signal.entity} score=${signal.score}`);
});
```

#### Public Namespaces (no auth required)

**`/dexscreener`** — Real-time token boost data from DexScreener WebSocket

| Event | Payload | Description |
|-------|---------|-------------|
| `boost` | `ScoredToken` | Token boosted with enriched metadata (price, liquidity, volume, FDV) |
| `token_update` | `ScoredToken` | Updated scoring after new data arrives |

**`/memecoins`** — Raw DEX token activity (swap events + new token creation)

| Event | Payload | Description |
|-------|---------|-------------|
| `memecoin` | `{ type, signature, chain, program, ... }` | Detected DEX swap or activity |
| `new_token` | `{ type, signature, chain, program, tokenMint, scored }` | New token creation on Pump.fun or Raydium |
| `token_update` | `ScoredToken` | Updated scoring after re-evaluation |

**Scanner client example:**

```javascript
const ws = new WebSocket("wss://tracker-ws.aitradepulse.com/socket.io/?EIO=4&transport=websocket")
ws.onopen = () => {
  ws.send("40/dexscreener")  // subscribe to /dexscreener namespace
  ws.send("40/memecoins")    // subscribe to /memecoins namespace
}
ws.onmessage = (event) => {
  if (event.data.startsWith("42/dexscreener,")) {
    const [, data] = JSON.parse(event.data.slice(16))
    if (data[0] === "boost") console.log("Boosted token:", data[1])
  }
}
```

#### Auth-Protected Namespaces

`/trades`, `/alerts`, `/prices`, `/flows`, `/orderbook`, `/derivatives`, `/liquidations` — require Bearer token.

---

## Project Structure

```
nexus/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (dashboard)/        # Dashboard layout group
│   │   ├── api/                # REST API routes
│   │   ├── dashboard/          # Main dashboard
│   │   ├── entities/           # Entity explorer
│   │   ├── smart-money/        # Smart money signals
│   │   ├── flows/              # Capital flow visualization
│   │   ├── predictions/        # Prediction markets
│   │   ├── tokens/             # Token analytics
│   │   └── alerts/             # Alert management
│   ├── components/             # React components
│   │   ├── domain/             # Business domain components
│   │   ├── entity/             # Entity cards, graphs, tables
│   │   ├── predictions/        # Market cards, order books
│   │   └── ui/                 # Shared UI primitives
│   └── lib/                    # Shared utilities
│       ├── alerts/             # Alert engine (evaluator, delivery)
│       ├── api/                # API middleware (auth, rate-limit)
│       ├── events/             # Redis event publisher
│       └── ws/                 # WebSocket client
├── indexer/                    # Blockchain indexer (separate process)
│   ├── chains/                 # Chain-specific listeners
│   │   ├── ethereum.ts         # ETH/ARB/BASE/OP via eth_subscribe
│   │   ├── solana.ts           # SOL via accountSubscribe
│   │   └── bitcoin.ts          # BTC via Blockstream REST polling
│   ├── processors/             # Transaction decoding & smart money detection
│   └── publisher.ts            # Redis event publisher
├── ws-server/                  # WebSocket sidecar (separate process)
│   ├── server.ts               # Socket.io server with DexScreener WS + token scoring
│   ├── auth.ts                 # Bearer token authentication
│   ├── score.ts                # Token scoring engine (hype score 0-100)
│   ├── subscriber.ts           # Redis event subscriber
│   └── __tests__/              # Score engine unit tests
├── prisma/
│   ├── schema.prisma           # Database schema (12 models)
│   └── seed.ts                 # Seed script (50 entities, 500 markets)
└── docker-compose.yml          # Unified Docker Compose (5 services)
```

---

## Database Schema

12 models covering the full intelligence stack:

- **Entity** — Tracked organizations (whales, funds, exchanges, protocols)
- **Wallet** — Blockchain addresses linked to entities
- **Trade** — Decoded on-chain transactions with smart money scoring
- **Flow** — Capital movement between entities
- **Signal** — Smart money detection events
- **PredictionMarket** — Crypto prediction markets
- **MarketPosition** — User positions in prediction markets
- **Alert** — User-configured alert conditions
- **AlertDelivery** — Alert webhook delivery log
- **IndexerCheckpoint** — Blockchain sync state per chain
- **Token** — Tracked token metadata
- **User** — Authentication and API key management

---

## Configuration

All configuration via environment variables. Zero required for local development with Docker Compose.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://nexus:nexus@postgres:5432/nexus` | PostgreSQL connection |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `NEXTAUTH_SECRET` | `nexus-dev-secret` | Session encryption key |
| `NEXUS_API_KEYS` | `nexus-dev-key` | WebSocket auth keys |
| `ETH_WS_URL` | `wss://ethereum-rpc.publicnode.com` | Ethereum WebSocket RPC |
| `SOLANA_WS_URL` | `wss://api.mainnet-beta.solana.com` | Solana WebSocket RPC |
| `LOG_LEVEL` | `info` | Indexer log verbosity |
| `ALCHEMY_API_KEY` | _(none)_ | Alchemy enhanced APIs (token balances, transfers, NFTs) |
| `HELIUS_API_KEY` | _(none)_ | Helius enhanced Solana (enriched txs, DAS API) |
| `ETHERSCAN_API_KEY` | _(none)_ | Etherscan transaction history & gas prices |
| `ARBISCAN_API_KEY` | _(none)_ | Arbitrum transaction history |
| `BASESCAN_API_KEY` | _(none)_ | Base transaction history |
| `OPTIMISM_ETHERSCAN_API_KEY` | _(none)_ | Optimism transaction history |

Override any RPC endpoint to use your own node infrastructure:

```bash
# .env
ETH_WS_URL=wss://your-own-eth-node.example.com
SOLANA_WS_URL=wss://your-own-solana-rpc.example.com
```

---

## Use Cases

### For Crypto Traders
- Track whale wallet movements before they impact price
- Get real-time alerts when smart money accumulates or distributes
- Monitor capital flows between exchanges and DeFi protocols

### For On-Chain Analysts
- Map wallet clusters to known entities
- Analyze transaction patterns across multiple chains
- Build custom dashboards with real-time data feeds

### For Developers
- Integrate whale tracking into your trading bot via WebSocket API
- Build custom alert systems using the REST API
- Extend the indexer with new chains or transaction types

### For Researchers
- Study whale behavior patterns and market impact
- Analyze smart money timing relative to price movements
- Track prediction market accuracy over time

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Related Projects

- [PolyEdge Trading Bot](https://github.com/oyi77/1ai-poly-trader) — Plugin-based trading bot with NEXUS integration
- [Blockstream API](https://github.com/Blockstream/esplora) — Bitcoin blockchain explorer API
- [Public Node](https://publicnode.com) — Free public blockchain RPC endpoints

---

**Keywords**: crypto whale tracker, on-chain analytics, blockchain intelligence, smart money detection, whale wallet tracking, DeFi analytics, real-time blockchain monitoring, Ethereum analytics, Solana analytics, Bitcoin analytics, crypto transaction tracker, whale alert, on-chain data platform, open-source crypto analytics
