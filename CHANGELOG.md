# Changelog

All notable changes to the NEXUS finance intelligence platform are documented in this file.

## v1.4.0 — Real Options Chain + Alert Pipeline + TradFi Route Cutover

### New Features

- **Real Deribit Options Chain** — `/options` now shows live BTC/ETH options data from Deribit with bid/ask, mark price, mark IV, Greeks, open interest, volume, and expiry tabs.
- **Structured Alert Builder** — `/alerts` now supports 6 alert types: `price_threshold`, `forex_rate`, `macro_event`, `wallet_moved`, `smart_money_action`, and `prediction_threshold`.
- **Manual Alert Evaluation** — `/api/v1/alerts/evaluate` checks active alerts against live market data and calendar events, and the alerts page can trigger evaluation on demand.
- **Dedicated TradFi Routes** — `/api/v1/forex`, `/api/v1/commodities`, and `/api/v1/equities` now provide dedicated server-side routes instead of relying on the generic module passthrough from the UI.

### Changed

- **Route Cutover** — `/forex`, `/commodities`, `/equities`, and `/compare` now fetch through dedicated backend routes with server-side caching.
- **Alert Engine Wiring** — `/api/v1/alerts` now validates alert configs against `src/lib/alerts/schemas.ts` and creates alerts through `src/lib/modules/derived/alert-engine.ts` so evaluation and delivery share one state path.
- **Alert Firing on Cold Start** — `fireAlert()` now lazy-loads DB alerts into the in-memory engine cache so triggered alerts are not silently dropped after restart.
- **Docs Sync** — README and architecture docs now describe NEXUS as a cross-asset finance platform instead of crypto-only.

## v1.3.0 — Calendar, Commodities, TradFi Alerts, and Monitoring

### New Features

- **Real Economic Calendar** — `/api/v1/calendar` now uses real FRED release dates plus central bank schedules (FOMC, ECB, BOJ, BI, BOE, RBA, RBNZ, PBOC, BCB).
- **Expanded Commodities** — `/commodities` grew from 4 instruments to a multi-category dashboard covering precious metals, energy, industrial metals, agriculture, and livestock.
- **TradFi Alert Types** — Added `price_threshold`, `macro_event`, and `forex_rate` conditions to the alert schema and evaluator.
- **TradFi / Macro Monitoring** — `/status` now monitors Yahoo Finance, ExchangeRate API, US Treasury, FRED, and World Bank in addition to crypto sources.

### Changed

- **Status UI** — `/status` now groups services by `core`, `crypto`, `tradfi`, and `macro`.

## v1.2.0 — Multi-Asset Navigation, Equities, and Global Compare

### New Features

- **Global Equities Dashboard** — `/equities` now covers major stocks across the US, Europe, Asia, Australia, Singapore, Canada, India, Korea, Taiwan, Brazil, and IDX.
- **Cross-Market Compare** — `/compare` now includes crypto, forex, commodities, indices, and macro categories in one table.
- **DeFi Sector Rankings** — `/sectors` now computes real 24h/7d weighted changes by aggregating DeFiLlama protocol data per chain.

### Changed

- **Sidebar Restructure** — navigation now exposes the multi-asset surface area (Markets, Macro & News, Analytics, On-Chain, Trading, DeFi, Tools) instead of a crypto-heavy layout.
- **Macro Pipeline** — `src/lib/fred-client.ts` now uses the real `FRED_API_KEY` when present and falls back to Treasury/World Bank/Yahoo only when required.
## v1.1.0 — Real-Time DEX Watcher

### New Features

- **DexScreener WebSocket** — Real-time token boost subscription via `wss://ws-api.dexscreener.com`. Live enriched metadata (price, liquidity, volume, FDV) pushed to `/dexscreener` Socket.IO namespace.
- **New Token Creation Detection** — Solana DEX monitoring enhanced to detect `create` events on Pump.fun and `initialize2` on Raydium CPMM/CLMM. Emits `new_token` events on `/memecoins` namespace.
- **Hype Scoring Engine** — Real-time token scoring (0-100) based on boosts, volume, liquidity, FDV, swap count, and age. Automatically classifies risk (low/medium/high/extreme). In-memory registry in `ws-server/score.ts`.
- **Telegram Alert Bridge** — High-score tokens (≥75) automatically broadcast to all registered Telegram chat IDs via Redis channel `nexus:memecoin-alerts`. Bridge consumes alerts in `src/instrumentation.ts`.
- **Scanner Real-Time WS** — Scanner UI (`/scanner`) now connects to both `/dexscreener` and `/memecoins` WebSocket namespaces for sub-second token detection. REST polling retained as fallback. Live indicator shows WS/REST status.

### Changed Files

- `ws-server/server.ts` — Added DexScreener WS connection, scoring engine, enhanced Solana new-token detection, `/dexscreener` namespace
- `ws-server/score.ts` — New: extractable, testable scoring module with `scoreToken()` and `tokenRegistry`
- `ws-server/__tests__/score.test.ts` — New: 18 unit tests for scoring engine
- `src/app/scanner/page.tsx` — Added WebSocket connection to `/dexscreener` + `/memecoins` namespaces for real-time data
- `src/instrumentation.ts` — Added Redis subscriber for `nexus:memecoin-alerts` channel, bridges to Telegram `broadcastAlert`
- `docs/architecture.md` — Updated WS server section with new namespaces and features
## v1.0.0 — Initial Release

### Platform

- Next.js 16 App Router frontend with React 19, Tailwind CSS 4, shadcn/ui
- Prisma 6 ORM with PostgreSQL 16 backend (14 data models)
- Redis 7 for Pub/Sub event bus and rate limiting cache
- Socket.IO WebSocket server for real-time event delivery
- Multi-chain blockchain indexer (Ethereum, Arbitrum, Base, Optimism, Solana, Bitcoin)
- Docker Compose deployment (6 services: postgres, redis, db-init, web, ws, indexer)
- Cloudflare Tunnel integration for production deployment at tracker.aitradepulse.com

### Data Sources (17 Integrations)

**Always Free (11 live, no API key required):**

- **DeFiLlama** — TVL, yields, DEX volumes, stablecoins, bridges, protocol fees
- **CoinPaprika** — 50K+ assets, tickers, global market overview
- **GeckoTerminal** — DEX trending pools, new pairs, OHLCV across 260+ networks
- **Jupiter** — Solana token pricing
- **CoinGecko** — Market data and prices
- **DexScreener** — DEX pair data (300 req/min)
- **Polymarket** — Prediction market data
- **Blockstream** — Bitcoin blockchain data (blocks, transactions, mempool)
- **Reservoir** — NFT collection data, sales, floor prices
- **RSS Feeds** — 30+ curated crypto news sources with credibility scoring
- **FRED** — Federal Reserve economic data (GDP, CPI, interest rates, employment, yield curve)
- **Exchange Rates API** — Major forex pairs (EUR/USD, GBP/USD, USD/JPY, etc.)

**Optional API Keys (3 need keys, free tiers available):**

- **Alchemy** — Enhanced RPC (token balances, transfers, NFT data) — 30M CU/month free
- **Helius** — Enriched Solana (transactions, DAS API, webhooks) — 100K credits/day free
- **Etherscan** — Transaction history, gas prices, contract data — 5 calls/sec free

**Additional (2 with optional keys):**

- **CryptoCompare** — News articles and market data (free tier, optional key for higher limits)
- **LunarCrush** — Social sentiment, Galaxy Score, Alt Rank (free tier, signup required)

### API Routes (19 v1 Endpoints)

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/fear-greed` | Composite crypto Fear & Greed Index (0–100 score with regime) |
| `GET /api/v1/feeds` | RSS feed aggregator from 30+ crypto news sources |
| `GET /api/v1/macro` | Macroeconomic indicators from FRED (rates, inflation, employment, GDP) |
| `GET /api/v1/market` | Cross-market overview (forex, commodities, crypto) |
| `GET /api/v1/ohlcv` | OHLCV candles with technical analysis (SMA, EMA, RSI, MACD, Bollinger) |
| `GET /api/v1/sectors` | Crypto sector analysis (8 sectors with per-token breakdown) |
| `GET /api/v1/stablecoins` | Stablecoin monitor with peg deviation and health status |
| `GET /api/v1/trending` | Trending tokens from GeckoTerminal and CoinPaprika |
| `GET /api/v1/news` | Crypto news articles from CryptoCompare |
| `GET /api/v1/data-sources` | Health and availability of all 17 data integrations |
| `GET /api/v1/tokens` | Token analytics with smart money flow rankings |
| `GET /api/v1/entities` | Tracked entities (whales, funds, exchanges, protocols) |
| `GET /api/v1/smart-money` | Smart money wallets with scoring and categorization |
| `GET /api/v1/alerts` | List user alert configurations |
| `POST /api/v1/alerts` | Create new alert with trigger type and conditions |
| `GET /api/v1/flows` | Aggregated capital flows between entities |
| `GET /api/v1/predictions` | Prediction market data with yes/no pricing |
| `GET /api/v1/defillama` | DeFiLlama multi-action endpoint (protocols, yields, chains, stablecoins, DEX volumes, bridges, fees) |
| `GET /api/v1/usage` | API key usage statistics |
| `GET /api/v1/wallets/:address` | Individual wallet analytics with holdings and transactions |

### Frontend Pages (16 Pages)

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/` | Platform overview and feature highlights |
| Dashboard | `/dashboard` | Main analytics dashboard |
| Tokens | `/tokens` | Token analytics and rankings |
| Token Detail | `/token/[address]` | Individual token deep-dive |
| Entities | `/entities` | Entity explorer (whales, funds, exchanges) |
| Entity Detail | `/entity/[slug]` | Individual entity profile |
| Smart Money | `/smart-money` | Smart money signal feed |
| Flows | `/flows` | Capital flow visualization |
| Predictions | `/predictions` | Prediction market interface |
| Alerts | `/alerts` | Alert management and configuration |
| DeFi | `/defi` | DeFi protocol explorer |
| NFT | `/nft` | NFT collection explorer |
| Marketplace | `/marketplace` | NFT marketplace |
| Data Sources | `/data-sources` | Data integration health dashboard |
| Portfolio | `/portfolio` | Portfolio tracker |
| Terminal | `/terminal` | Trading terminal interface |
| Compare | `/compare` | Cross-market comparison tool |
| Fear & Greed | `/fear-greed` | Fear & Greed Index page |
| Sectors | `/sectors` | Crypto sector analysis page |
| Stablecoins | `/stablecoins` | Stablecoin monitor page |
| Feeds | `/feeds` | RSS feed aggregator page |
| Wallet Detail | `/wallet/[address]` | Individual wallet profile |

### Features

- **Fear & Greed Index** — Composite crypto sentiment index built from volatility, momentum, BTC dominance, and volume change. Returns score, label, regime, and per-category breakdown.
- **Crypto Sectors** — Sector analysis across 8 categories (Layer 1, Layer 2, DeFi, Meme, AI, Gaming, Stablecoins, RWA) with average 24h change and top gainers/losers.
- **Stablecoin Monitor** — Tracks 10 major stablecoins with peg deviation calculation and health status (HEALTHY/CAUTION/WARNING).
- **RSS Feed Aggregator** — 30+ curated crypto news feeds with credibility scoring (high/medium/low), tiered sources (wire/mainstream/niche), and category filtering.
- **Macro Economic Dashboard** — FRED-powered macro indicators including Federal Funds Rate, 10Y-2Y spread, CPI, unemployment, GDP, USD index, oil, and gold.
- **Cross-Market Data** — Combined forex, commodities, and crypto overview with real-time rates from open.er-api.com.
- **Technical Analysis** — Pure TypeScript TA indicators: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, VWAP, Stochastic Oscillator. Auto-generated trading signals.
- **Command Palette** — Keyboard-driven navigation (Cmd+K) using cmdk.
- **Portfolio Tracker** — Wallet portfolio tracking and visualization.
- **Prediction Markets** — Polymarket integration with yes/no pricing, volume, and trader counts.
- **NFT Explorer** — NFT collection data with floor prices, volume, and wash trade scoring via Reservoir.
- **Entity Mapping** — Connect wallets to known entities with smart money scoring and verification status.
- **Capital Flow Analysis** — Aggregated transaction flows between entities with chain filtering.
- **Alert System** — User-configurable alerts with trigger types, JSON conditions, and webhook delivery.

### Infrastructure

- **Circuit Breaker** — Server-side circuit breaker (`src/lib/circuit-breaker.ts`) with ok/cooldown/degraded states. LRU cache for fallback data. Client-side SWR hook with localStorage persistence and exponential backoff.
- **Data Freshness Tracking** — `DataFreshnessTracker` monitors 14 sources with thresholds: fresh (< 15 min), stale (< 2 hours), very stale (< 6 hours).
- **Smart Polling** — Frontend `useSwrFetch` hook with tab-pause (stops polling when hidden), exponential backoff (1s–30s), and localStorage persistence.
- **Rate Limiting** — Two-layer: middleware in-memory per API key (200 req/min) + Redis sliding window per IP (100 req/min).
- **API Key Authentication** — Bearer token auth via `NEXUS_API_KEYS` env var. Middleware validates on all `/api/v1/*` routes.
- **Usage Tracking** — Per-API-key usage tracking in middleware with endpoint breakdown and top-endpoint ranking.
- **CORS** — Configured headers on all API responses.
- **Multi-Chain Indexer** — WebSocket subscriptions for EVM chains (`eth_subscribe`), Solana (`accountSubscribe`), and Bitcoin REST polling via Blockstream.
- **Redis Pub/Sub** — Event bus connecting indexer → WebSocket server for real-time fan-out.
- **Prisma ORM** — 14 models with strategic indexes on sort fields and foreign keys. Seed script populates 50 entities, 500 markets, 10K trades.
