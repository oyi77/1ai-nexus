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
- **Measured Wallet Discovery** — Rebuilds the tracked pool from GMGN leaderboard sweeps, holders of established (MC ≥ $1M) tokens (with on-chain RugCheck fallback when GMGN returns empty for non-pump mints), holders of contracts the call-feed flagged (`called-contracts`), and replayed `TokenHolding` rows of $1M+ tokens (`persisted-holdings`). Each leg reports its own admission count, so a high-cap sweep can never claim the call-feed's results. No wallet enters unless it clears the HUMAN check (fastTxRatio, sells > 0, ≥ 10 trades) and GMGN's own bundler/sniper/fresh/transfer-in flags
- **Tradeable-Market Gate** — The called-contracts leg reads DexScreener market rows for the WHOLE feed before it spends any holder budget. A mint below `WALLET_DISCOVERY_MIN_LIQUIDITY` (default $50k), or one whose liquidity no source reported, is skipped and named in the refusal log instead of consuming a holder read: measured live, every top-ranked call sat at $3k-$38k liquidity while mints with $61k-$110k books ranked below them and were never looked at. The market filter runs FIRST and confluence ranking second, so call weight can never buy a shill a budget slot
- **Holder-Share Gate** — A holder's value is measured as a SHARE of the mint it sits in, not in raw dollars: a $463k holder of a $73.6M mint is 0.6% (irrelevant to price) while a $577 holder of a $721k mint is 8% (the entire trade). The floor is a USD target restated in that mint's own cap — `min(WALLET_DISCOVERY_MAX_HOLDER_SHARE, WALLET_DISCOVERY_HOLDER_SHARE_USD / marketCapUsd)` — so a fixed percentage is never wrong in both directions. An unmeasured cap applies the ceiling (strict), and an unmeasured share is a refusal, never a pass
- **Unmeasured Holder Share Stays Null** — GMGN's holder list sometimes returns a row with no `amount_percentage`. That share is typed `number | null` from the response through `GmgnHolderRow` to `pctOfSupply`, and `validateHolder` refuses it rather than writing a `0`: `TokenHolding.amount` is a non-null Float, so the only honest outcomes are a skipped row or a fabricated holder-sized zero, and the second one enters every downstream floor as "this wallet holds nothing". A MEASURED zero stays zero, because a holder who genuinely holds nothing is a different fact from a row the source could not size — the same distinction the dev-history gate and the LP-burn leg already enforce
- **Diagnosable Leg Counters** — Each holder leg reports `thinMarket`, `thinShare`, `underFloor`, `noMark` and `bestShare` alongside `admitted`, because "0 admitted" otherwise reads identically for "the feed called nothing", "every mint was too thin to trade" and "every holder was dust" — three states with three different fixes. The pass also runs under `data/.wallet-discovery.lock` (30-min stale reclaim): a measured pass takes 4-7 minutes, so a shorter schedule would otherwise stack concurrent passes against the same GMGN quota
- **Measured Signal Outcomes** — Every delivered sniper signal is scored on its own horizon: TARGET at +100%, STOPPED at −50%, FLAT inside the ±10% noise band, and WIN/LOSS for real moves outside it. Hit rate counts targets only; win rate counts every decided direction. PENDING and UNPRICEABLE are reported separately and never counted as misses
- **Tier Calibration** — Per-tier hit rates turn into delivery demotions once a tier has `minScored` (default 5) scored signals below `SNIPER_CALIBRATION_FLOOR_PCT` (default 50). Off by default; `SNIPER_ADAPTIVE_POLICY_DRY_RUN=true` logs the verdict without touching delivery
- **Self-Refreshing Insight Brief** — Cross-domain transmission legs (perps funding crowding, IDX foreign flow, sector rotation, fear/greed sentiment extremes, US Treasury yield curve slope [10Y-2Y / 10Y-3M], and corporate credit spreads [BAA10Y]) cite a measured sample or say so. Funding-unwind cells recompute daily from `DerivativesSnapshot` and replace a baked backtest cell only once the live cell clears `n ≥ 20`; macro yield curve and credit spread legs evaluate real-time FRED data from `MacroDataPoint` (inversion vs steepening, credit distress vs compressed calm); a leg backed by the baked cell is stamped with that cell's own sample date, never today's, and the regime counts proven legs only
- **Call-Group Confluence Gate** — A candidate can be required to have been called by N independent groups, where each group is weighted by how often it *originates* a call rather than re-broadcasts one. Counts are groups, never messages. The feed reports readability separately from emptiness: `readOk:false` (source threw, artifact dead/expired) surfaces as "call-feed unreadable" and never as "nobody called it", because those two have opposite fixes. A per-contract tri-state keeps the reason unambiguous: `available:false` (the source could not be read), `available:true, present:false` (the feed answered and no group called this contract), and `present:true` (groups named, with weighted votes). Only the first is an outage; the second is a measurement.
- **Dev-History Gate** — Rejects a token whose developer has repeatedly shipped nothing that migrates, and now refuses to judge what it cannot yet measure: tokens younger than `matureMinAgeSeconds` (default 1h) are set aside from the migration math instead of being counted as failed migrations, and a token whose `migrated` field upstream never reported is excluded from the judged sample rather than read as "did not migrate". Every verdict carries `previousTokens`, `matureTokens`, `knownMigrations`, and `migrationRate`, so a rejection names the sample it was earned on (`SUSPECT … across 2 mature deploys with a reported outcome (out of 3 total)`) instead of implying all three failed. `0` judged tokens is UNPROVEN, never CLEAN
- **Measured Gate Arithmetic (why delivery is 0)** — The sniper pipeline is verified end-to-end (cron `*/5` → discover → audit → evaluate → classify → deliver) yet ships nothing, and that is the correct output of the current criteria, not a wiring bug. Replayed over 200 stored decisions in `data/sniper-log.json`: every row is `REJECT`, **no row fires fewer than three rule families**, and the cheapest drop-set that admits a single candidate is three families wide. Per-family reach: momentum 192/200 (max observed 5m vol/mcap **1.05×** against a 2×/4× floor — a 4× floor demands the entire cap turn over four times per five minutes), launch cohort 183 (median sold 98.4%, observed ceiling **99.9** because `bundlerSoldPercent` is derived from GMGN `holding_rate` rounded to one decimal, so `bundlerExitRequiredPercent: 100` is reachable only at an exact zero holding rate), `[golden]` single-whale 171 (median 33.9% against a 5% ceiling), top-10 127 (median 65.3% against 30%). Sensitivity sweep: cohort thresholds 99.9/99.5/99.0/98.0 clear 13/25/69/86 rows respectively and **admit zero** — every row that clears cohort still rejects on another family. Raised top-10 ceilings up to 90% add nothing. The binding constraint is the *population*, not one gate: the profile encodes post-migration maturity while discovery serves fresh mints. Relaxing one number cannot produce a signal; changing three or more would ship tokens this profile calls unsafe, so that decision belongs to the operator, not to a calibration sweep
- **Truthful Rejection Shares** — A rejected share is by definition non-zero, but `fmtPct` rounds to one decimal, which printed `Dev holds 0% (must be 0%; hard ceiling 2%)` for 33 measured readings between 0.0025% and 0.032% — a self-contradicting message that reads as a gate bug rather than a dust position. `fmtPctBreach` formats rejection text only: anything that rounds away prints `<0.1`, everything else keeps `fmtPct`'s precision. Signal and warning text keep `fmtPct` unchanged. The gate itself is untouched (`devPercent > 0` still rejects); only the sentence is honest
- **Sniper Review Near-Miss Surface** — `/meme/sniper` provides a dedicated `near-miss` review tab that isolates rejected candidates exhibiting real 5m momentum flow (`vol/mcap ≥ 0.5×`) or $\le 2$ non-critical rule breaches, while strictly excluding critical risks (honeypot, mint authority, freeze authority). Production execution and gate thresholds remain 100% unaltered.
- **Fail-Closed Risk & Audit Surface Alignment** — `/meme/sniper` and `/meme/risk` enforce fail-closed evaluation for all contract risk indicators: active mint authority (`canMint`), freeze authority (`canFreeze`), or verified honeypot flags are classified strictly as `High Risk` with visual badge indicators. `MemeRiskAudit` flags column explicitly unpacks `isHoneypot` alongside freeze and mint permissions.
- **Comprehensive Meme UI & Screener Surfaces** — All meme routes (`/meme`, `/meme/sniper`, `/meme/leaderboard`, `/meme/launch-alpha`, `/meme/risk`, `/meme/moby`) isolate client-side data queries and `useSearchParams` within safe `<Suspense>` boundaries. `/meme/moby` delivers multi-asset smart-money screener capabilities with group inspection, launchpad boards, trader PnL tracking, and price charts with zero unhandled loading states or blank frames.
- **Macro Transmission Visual Panel** — `/signals?tab=macro` renders real-time US Treasury yield curve slope (`10Y-2Y` / `10Y-3M`) and Baa corporate credit spread (`BAA10Y`) factor cards alongside the active cross-asset transmission table and global regime badge (`risk-on`, `risk-off`, `mixed`), backed by FRED data in `MacroDataPoint`.
- **Zero-Issue Audit Resilience & Self-Healing Feeds** — All 22 system-wide health and pipeline verification checks in `npm run cron:zero-issue` pass cleanly. Feed health probes (106 live RSS/Atom sources across 12 categories) execute concurrently via parallel batching with in-memory caching and zero dead active feeds. IDX Saham Relative Strength (`/api/v1/saham/signals?view=rs`) and IDX Corporate Calendar (`/api/v1/saham/calendar`) endpoints implement graceful fallback handling, returning HTTP 200 with structured data and fallback notices during missing snapshot or upstream downtime windows.
- **RSS News Ingestion & Intelligence Pipeline** — Ingests live news items across 106 verified RSS/Atom feeds into the `NewsArticle` database model with URL deduplication, automatic multi-asset entity extraction (`BTC`, `ETH`, `SOL`, `BBCA`, `BBRI`, `ASII`, `IHSG`, `NVDA`, etc.), and polarity sentiment classification (`bullish`, `bearish`, `neutral`). CLI runner available via `npm run ingest:news` (`src/scripts/ingest-feeds.ts`).
- **Comprehensive Terminal Route & API Audit Verification** — System-wide prober verification across all 108 navigation destinations (`src/lib/config/nav.ts`), 127 static app pages, and 205 API routes under `src/app/api/`. Proved 100% 200 OK on all 108 nav items, zero 5xx errors across all APIs, zero console errors and zero page errors across major landing surfaces via headless browser execution. Integrated graceful degradation fallbacks on `/api/v1/dex/new-pairs` (empty structure on GeckoTerminal rate limits) and `/api/v1/mempool` (structured fallback on mempool.space upstream timeouts) ensuring zero unhandled 502 Bad Gateway exceptions.

---

## Information Architecture

The shell is an **OPERATE / MONITOR surface**: dense, left-aligned, no hero sections, no marketing copy. Navigation lives in `src/lib/config/nav.ts` as a single typed structure — changing the source file is the only way to change the sidebar, so routes and nav can never drift apart.
Eight collapsible sections, 108 unique destinations, zero duplicate `href` and zero duplicate React `key` (enforced by `src/lib/config/__tests__/nav.test.ts`).

### Progressive Disclosure & Active Matcher Engine
- **Precision Active Matcher (`src/lib/config/nav-matcher.ts`)**: Resolves active navigation items via deterministic specificity scoring (`getActiveNavHref`). Eliminates prefix collisions (navigating to `/meme/sniper` activates `/meme/sniper` and never greedily matches `/meme`) and handles query parameter tabs (navigating to `/signals?tab=alpha` activates `/signals?tab=alpha` over base `/signals`). Only one navigation item across the entire sidebar receives active status.
- **Simple vs Pro Navigation Modes**: Integrated segmented mode toggle in the sidebar header:
  - **Simple Mode**: Curated 14 primary essential tools across core sections (`/dashboard`, `/watchlist`, `/portfolio`, `/signals`, `/signals?tab=alpha`, `/fear-greed`, `/screener`, `/saham`, `/trending`, `/smart-money`, `/whale-cluster`, `/copy-trading`, `/meme/sniper`, `/meme/risk`). Eliminates cognitive overload for casual users.
  - **Pro Mode**: Full 108 instruments and forensic tools with visual sub-category headers (`Core & Screeners`, `Indonesian & Equities`, `Crypto & Tokens`, `TradFi & Derivatives`, `Whales & Smart Money`, `DEX Radar & Scanners`, `DeFi & Yields`, `Ecosystem & Macro`).
  - **Persistence**: User mode preference persists across reloads via `localStorage` (`nexus_nav_mode`).
  - **Visual Badges**: Subtle indicator pills (`HOT`, `ID`, `PRO`, `AI`) highlight key Indonesian (`/saham`), high-conviction, and trending tools.

- **Unified Mega Search Popup & Command Palette (`GlobalSearch.tsx` + `CommandBar.tsx`)**:
  - **Click & Keyboard Triggers**: Clicking the TopBar search bar or pressing `⌘K` / `Ctrl+K` or `/` opens a centralized, full-screen overlay modal (`max-w-4xl`).
  - **Raycast/Linear Split-View**: Left column provides keyboard-navigable (`↑`/`↓`) categorized results across Navigation Pages, Market Assets (Indices, Stocks, Commodities, Crypto), Trader Profiles, and Bloomberg Terminal Commands. Right column provides a real-time Preview Pane displaying item descriptions, target destinations, and execution syntax.
  - **Zero-Query Quick Jumps**: Opening the modal with an empty query displays curated essential shortcuts (`Dashboard`, `AI Signals`, `IDX Saham`, `Smart Money`, `Meme Sniper`) and top executable commands (`KIMCHI`, `FEAR`, `NEWS ID`, `SCREENER`) instead of a blank frame.
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

One command starts the nine-service stack: PostgreSQL, Redis, ClickHouse, migration-only `db-init`, Next.js, WebSocket, indexer, MCP server, and re-verifier. Demo data is not seeded automatically.

```bash
git clone https://github.com/oyi77/1ai-nexus.git 1ai-tracker
cd 1ai-tracker
cp .env.example .env  # fill REQUIRED values; do not commit this file
mkdir -p secrets
for name in db_password redis_password clickhouse_password; do openssl rand -hex 32 > "secrets/$name.txt"; done
chmod 600 secrets/*.txt
docker compose up --build
```

The `db-init` service only runs `prisma migrate deploy`; it never seeds demo data. The seed script is optional, synthetic, and fresh-empty-database-only: it aborts if users or entities already exist.

| Service | Port | Description |
|---------|------|-------------|
| `postgres` | 5432 | PostgreSQL 16 database |
| `redis` | 6379 | Redis Pub/Sub event bus |
| `clickhouse` | 8123 | ClickHouse analytics database |
| `db-init` | — | Runs once: `prisma migrate deploy` against Postgres |
| `web` | 4400 | Next.js 16 application |
| `ws` | 4401 | WebSocket sidecar (Socket.io) |
| `indexer` | 4409 | Multi-chain blockchain indexer health server |
| `mcp-server` | 4402 | Model Context Protocol server |
| `re-verifier` | — | Re-verifies reverse-engineered modules |

Open [http://localhost:4400](http://localhost:4400) — sign up, then promote yourself to admin in psql (docs/HANDOVER.md §3).

**Production**: [https://tracker.aitradepulse.com](https://tracker.aitradepulse.com)

### Local Development

```bash
# Prerequisites: Node.js 20+, PostgreSQL 16, Redis 7
docker compose up -d redis

npm ci  # stage vendor/1ai-payment-0.1.0.tgz first; see docs/HANDOVER.md §2
npx prisma migrate deploy  # NEVER db:push on a migrated DB
# Optional demo data: only on a new empty development database, never production.
# npm run db:seed
# Run (in separate terminals):
npm run dev                            # Next.js on :4400
cd ws-server && npm ci && npm run dev  # WebSocket on :4401
cd indexer && npm ci && npm run dev    # Blockchain indexer on :4409
```

**Execution boundary:** this repository performs screening and research only. `SHADOW` and `PAPER` simulations, `paper-buy`, forward tests, and backtests use virtual balances; no live order or on-chain execution path exists here. `SNIPER_EXECUTE_ENABLED` is a legacy test-only input: setting it does not enable trading. See `vendor/PROVENANCE.json` for the exact `@1ai/payment` archive source, checksum, and lockfile staging contract.

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
git clone https://github.com/oyi77/1ai-nexus.git 1ai-tracker
cd 1ai-tracker
cp .env.example .env  # fill REQUIRED values
mkdir -p secrets
for name in db_password redis_password clickhouse_password; do openssl rand -hex 32 > "secrets/$name.txt"; done
chmod 600 secrets/*.txt
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
set -a; . ./.env; set +a
bash scripts/backup-db.sh  # restore: isolated rehearsal in docs/HANDOVER.md §5
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
└── docker-compose.yml          # Unified Docker Compose (9 services)
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

All configuration is supplied via environment variables and Compose secrets files. Docker Compose requires `.env` (filled with the REQUIRED keys from `.env.example`) plus the three secret files (`secrets/db_password.txt`, `secrets/redis_password.txt`, `secrets/clickhouse_password.txt`).

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
