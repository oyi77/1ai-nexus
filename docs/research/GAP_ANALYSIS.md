# Gap Analysis
> Platform: 1ai-nexus | Updated: 2026-06-24 | Read with: FEATURE_MATRIX.md

## Scoreboard
- Total features tracked: 30
- Our ✅/⭐: 24 (80%)
- Our ❌: 1 (3%)
- Our 🚧: 5 (17%)
- P0 open: 1 | P1 open: 3 | P2 open: 4

---

## P0 — Critical Gaps (fix before anything else)

### GAP-001: Token God Mode (All Holders)
- **Status:** ❌
- **Competitors who have it:** Nansen (⭐), GMGN (✅)
- **User impact:** Users can't see who holds a token, their cost basis, or PnL — critical for alpha
- **User evidence:** "Nansen's Token God Mode is the single most useful feature in crypto" — common Reddit sentiment
- **Done looks like:** For any token address, show all holders with balance, cost basis, unrealized PnL, entity labels
- **Effort:** L
- **Sprint:** Current
- **Closed:** [ ]

---

## P1 — Strategic Gaps (surpass, not just match)

### GAP-010: Knowledge Graph Interactivity
- **Status:** 🚧 (basic D3 graph exists, but lacks zoom/pan/search)
- **Best competitor version:** Arkham — smooth zoom, node click → entity detail, search
- **Our current state:** Static D3 force graph, no zoom, no search, no click navigation
- **Surpassed looks like:** Google Maps-like zoom/pan, node click → entity detail, search filter, cluster detection
- **User evidence:** Arkham users cite the graph as the most "addictive" feature
- **Effort:** M
- **Sprint:** Current
- **Closed:** [✅] — zoom/pan/search added via d3-zoom

### GAP-011: Order Book Real-time Updates
- **Status:** 🚧 (REST polling every 3s)
- **Best competitor version:** Hyperdash — sub-second WebSocket updates
- **Our current state:** REST polling every 3s, server-side cache
- **Surpassed looks like:** WebSocket from Binance → server → broadcast to all clients
- **Effort:** M
- **Sprint:** Current
- **Closed:** [✅] — WebSocket depth stream via nexus-ws

### GAP-012: Copy Trading
- **Status:** 🚧 (page exists but limited)
- **Best competitor version:** GMGN — follow whale wallets, auto-execute trades
- **Our current state:** Basic copy trade page, no real execution
- **Surpassed looks like:** Follow any wallet, receive real-time alerts on their trades, paper trade execution
- **Effort:** L
- **Sprint:** Next
- **Closed:** [ ]

---

## P2 — Moat Opportunities (nobody has this)

### MOAT-001: Alpha Signal Engine (Cross-Correlation)
- **Source of insight:** Trade flow + whale alerts + funding rates + sentiment cross-correlation
- **User pain it solves:** Traders manually correlate 5+ data sources — we automate it
- **Why competitors haven't done it:** Each competitor focuses on their niche (Nansen=on-chain, Hyperdash=derivatives)
- **Our edge:** We have ALL data sources under one roof — 20+ live feeds
- **Effort:** M
- **Target sprint:** Current
- **Closed:** [✅]

### MOAT-002: Paper Trading with Accuracy Tracking
- **Source of insight:** Record predictions, track win rate over time
- **User pain it solves:** Traders can't backtest their signals — we give them a scorecard
- **Why competitors haven't done it:** Not their business model — they sell data, not tools
- **Our edge:** We have the data + the engine + the UI under one roof
- **Effort:** S
- **Target sprint:** Current
- **Closed:** [✅]

### MOAT-003: Zero-API-Key Platform
- **Source of insight:** Every competitor requires API keys or paid subscriptions
- **User pain it solves:** Setup friction — users just want to use the tool, not configure APIs
- **Why competitors haven't done it:** API keys are their business model
- **Our edge:** All 20 data sources work without any API key — unique in the market
- **Effort:** Done
- **Target sprint:** Done
- **Closed:** [✅]

### MOAT-004: Prediction Market Aggregation
- **Source of insight:** Polymarket + Manifold + Metaculus in one view
- **User pain it solves:** Prediction market traders check 3+ platforms manually
- **Why competitors haven't done it:** Prediction markets are niche — not their focus
- **Our edge:** We aggregate 3 platforms with cross-platform correlation
- **Effort:** S
- **Target sprint:** Current
- **Closed:** [✅]

---

## Closed (Archive)
| Gap ID | Name | Sprint | Result |
|--------|------|--------|--------|
| GAP-010 | Knowledge Graph Interactivity | Current | ✅ d3-zoom + search + click |
| GAP-011 | Order Book Real-time | Current | ✅ WebSocket depth stream |
| MOAT-001 | Alpha Signal Engine | Current | ✅ Cross-correlation engine |
| MOAT-002 | Paper Trading | Current | ✅ Accuracy tracking |
| MOAT-003 | Zero API Keys | Current | ✅ All 20 sources free |
| MOAT-004 | Prediction Markets | Current | ✅ 3-platform aggregation |

## Discovery Log
| Date | Gap | Source | Priority |
|------|-----|--------|----------|
| 2026-06-24 | Token God Mode | Nansen feature matrix | P0 |
| 2026-06-24 | Copy Trading | GMGN feature matrix | P1 |
| 2026-06-24 | Order Book WS | Hyperdash comparison | P1→✅ |
