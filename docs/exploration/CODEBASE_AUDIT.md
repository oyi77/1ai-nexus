# Codebase Audit — 2026-06-30

## Stack
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS
- **Backend:** Next.js API Routes, Prisma ORM, PostgreSQL 16, Redis (ioredis)
- **Real-time:** Socket.IO (nexus-ws on port 4401), WebSocket streams
- **Indexer:** Custom TypeScript indexer (ETH/ARB/BASE/OP/SOL/BTC)
- **Process Manager:** PM2 (nexus-web:4400, nexus-ws:4401, nexus-indexer:4409)
- **Testing:** Vitest (219 tests, 22 test files)
- **Key Libraries:** lightweight-charts, recharts, d3-force/d3-selection/d3-zoom, lucide-react

## Data Pipeline (as of 2026-06-30)
- **Macro:** 22 FRED series (all working) — Treasury CSV (8), World Bank (3), Yahoo Finance (1), FRED API (10)
- **Equities:** 50+ global stocks via Yahoo Finance, 8 major indices
- **Crypto:** 8 exchange WebSockets, DexScreener, DeFiLlama, CoinGecko
- **DeFi:** 15K+ yield pools, protocol revenue, stablecoin flows
- **News:** 139 RSS feeds, Fear & Greed index

## Navigation Structure (8 sections, 40+ pages)
```
Overview:    Dashboard, Alpha Feed, Watchlist, Alerts
Markets:     Equities, Forex, Commodities, Derivatives
On-Chain:    On-Chain Hub, Token Scanner, Token God Mode, Knowledge Graph, Top Traders
Trading:     Order Book, Basis Scanner, Liquidations, Arbitrage, MEV Detector
Macro:       Macro Hub, Calendar, Fear & Greed, Correlations, Gaps, News Feed
DeFi:        DeFi Hub, Stablecoins, Sectors
Analytics:   Analytics Hub, Compare, Insider, Weather
Tools:       PnL Tracker, Exchange Flow, Gas Tracker, Status, Live Trades
```

## Architecture Score
| Dimension | Score | Notes |
|-----------|-------|-------|
| Scalability | 🟡 | PM2 cluster + Redis, but single-process indexer |
| Maintainability | 🟢 | Clean module registry, good separation |
| Extensibility | ⭐ | 58 data modules, easy to add sources |
| Observability | 🟡 | PM2 logs, /api/v1/status/cache, but no structured logging |
| Security | 🟢 | Zero hardcoded secrets, rate limiting, SSRF protection |
| Multi-Asset | 🟡 | Infrastructure ready, but IDX/IDR/Indonesian macro missing |

## Critical Gaps for 2B IDR/year Pricing
1. **IDX integration** — no Indonesian stock data
2. **IDR forex** — no USD/IDR, EUR/IDR
3. **Indonesian macro** — no BI rate, local CPI
4. **Technical indicators** — charts have no indicators
5. **Multi-asset screener** — no filter/search across assets

## Quick Wins (High impact, low effort — do now)
1. Add USD/IDR forex pair (Yahoo Finance: USDIDR=X) — 1 hour
2. Add IDX stocks to equities page (Yahoo Finance: BBCA.JK) — 2 hours
3. Add basic technical indicators to charts (RSI, SMA, EMA) — 1 day

## Scheduled Improvements (High impact, high effort — roadmap)
1. Indonesian macro data pipeline (BI, BPS, OJK)
2. Multi-asset screener with 20+ criteria
3. Drawing tools on charts
4. Portfolio risk analytics
5. WhatsApp Business API alerts
