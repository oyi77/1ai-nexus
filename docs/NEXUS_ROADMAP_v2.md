# NEXUS Roadmap v2

> **Date:** 2026-06-20 · **Repo:** oyi77/1ai-nexus · **Production:** tracker.aitradepulse.com
> **North Star:** Can a real trader use this to make money today?
> **Generated from:** QA_AUDIT_REPORT.md (26 bugs) + COMPETITIVE_GAP_ANALYSIS.md (18 gaps)
> **Total estimated effort:** 12 weeks (1 developer) or 4 weeks (3 developers parallel)

---

## Sprint 0 — P0 Fixes: Security + Data Correctness

**Duration:** 1 week · **Goal:** Make the platform safe and trustworthy

### Why First

No trader should use a platform with unauthenticated admin endpoints, command injection, and non-deterministic signals. These are blockers — everything else is built on top.

### Tasks

| # | Task | Bug/Gap | Effort | Owner |
|---|------|---------|--------|-------|
| 0.1 | Remove write routes from PUBLIC_API_ROUTES (alerts/create, user/api-key, cron/start, modules/fetch) | BUG-001 | 2h | Backend |
| 0.2 | Add SSRF validation to webhook URLs (block private IPs, require https) | BUG-002 | 4h | Backend |
| 0.3 | Replace `execSync` with `execFileSync` in curlFetch() | BUG-004 | 1h | Backend |
| 0.4 | Add Bearer token auth to MCP server, restrict CORS | BUG-005 | 2h | Backend |
| 0.5 | Remove `Math.random()` from computeSignals(), use deterministic formula | BUG-003 | 2h | Backend |
| 0.6 | Add USD conversion to BTC indexer (fetch price from DeFiLlama) | BUG-011 | 2h | Backend |
| 0.7 | Add USD conversion to SOL indexer (lamports → SOL → USD) | BUG-012 | 2h | Backend |
| 0.8 | Change WS auth to deny-all when NEXUS_API_KEYS empty | BUG-009 | 1h | Backend |
| 0.9 | Add pagination to unbounded queries (alerts, transactions, flows) | BUG-006 | 4h | Backend |
| 0.10 | Wire HMAC signing to active alert engine | BUG-013 | 2h | Backend |
| 0.11 | Sanitize Redis URL in console.log | BUG-019 | 0.5h | Backend |

**Total: 22.5h (~3 days)**

### Free API Sources

| Data | Source | Auth Required |
|------|--------|---------------|
| BTC price | DeFiLlama `/coins` | No |
| SOL price | DeFiLlama `/coins` or Jupiter | No |

### Definition of Done

- [ ] `curl -X POST /api/v1/alerts/create` returns 401 without API key
- [ ] `curl -X POST /api/v1/cron/start` returns 401 without API key
- [ ] `curlFetch("http://example.com/$(id)")` does NOT execute shell commands
- [ ] `curl http://localhost:4402/tools/list` returns 401 without API key
- [ ] Same transaction processed 100 times yields identical smart money score
- [ ] BTC transaction shows USD value, not raw BTC
- [ ] SOL transaction shows USD value, not raw lamports
- [ ] WebSocket connection rejected when NEXUS_API_KEYS is empty
- [ ] Alert creation with `webhookUrl: "http://10.0.0.1"` is rejected (SSRF)
- [ ] Webhook deliveries include `X-Nexus-Signature` header
- [ ] All `/api/v1/*` write routes require Bearer token
- [ ] `npm run test` passes (all existing tests)
- [ ] `npm run build` succeeds

### Rollback Strategy

Each task is a single-file change. Revert individual commits if any fix causes regression. The auth changes (0.1, 0.4, 0.8) are the highest risk — test with the frontend to ensure dashboard still loads without auth for read-only routes.

---

## Sprint 1 — P1 Gaps: Top 5 Competitive Gaps

**Duration:** 2 weeks · **Goal:** Close the biggest gaps vs Nansen, GMGN, Whale Alert

### Why This Sprint

After security fixes, the biggest gaps blocking trader profitability are: (1) no Telegram alerts, (2) broken smart money scoring, (3) tiny entity database, (4) no derivatives data, (5) no wallet PnL tracking.

### Tasks

| # | Task | Gap | Effort | Owner |
|---|------|-----|--------|-------|
| 1.1 | **Telegram Bot** — Create bot with `/start`, `/subscribe whale`, `/subscribe smart-money`, `/subscribe price:BTC>100000`. Deliver alerts via Telegram Bot API. | GAP-002 | 3d | Backend |
| 1.2 | **Entity Label Expansion** — Import Open Labels Initiative (1000+ labels), Dune community labels (exchange wallets, VC funds), Etherscan verified contracts. Target: 10,000+ labels. | GAP-001 | 3d | Data |
| 1.3 | **Wallet PnL Tracking** — Track wallet buy/sell prices over time. Calculate realized PnL per wallet. Build leaderboard sorted by win rate and total PnL. | GAP-003 | 3d | Backend |
| 1.4 | **Derivatives Dashboard** — Fetch funding rates, open interest, liquidation data from Binance/Bybit/OKX public APIs. Display on new `/derivatives` page. Schema already exists (CexFundingRate, CexLiquidation). | GAP-006 | 2d | Full-stack |
| 1.5 | **Fix Circuit Breaker** — Make registry.fetchOne() check isModuleDegraded() before calling primary fetch. Return cached data or fallback when degraded. | BUG-015 | 1d | Backend |
| 1.6 | **Redis Caching Layer** — Add Redis-backed caching with TTL for module data. Replace in-memory Map in fetch-with-cache.ts. | BUG-016 | 1d | Backend |

**Total: 13 days**

### Free API Sources

| Data | Source | Auth Required |
|------|--------|---------------|
| Telegram alerts | Telegram Bot API | Bot token (free) |
| Entity labels | Open Labels Initiative (GitHub) | No |
| Entity labels | Dune community labels (GitHub) | No |
| Entity labels | Etherscan verified contracts | Free API key (5 req/s) |
| Funding rates | Binance `/fapi/v1/fundingRate` | No |
| Open interest | Binance `/fapi/v1/openInterest` | No |
| Liquidations | Bybit `/v5/market/recent-trade` | No |
| Wallet PnL | On-chain tx history (Blockstream, Etherscan) | No (Etherscan: free key) |

### Definition of Done

- [ ] Telegram bot responds to `/start` with help message
- [ ] `/subscribe whale` delivers whale alerts to Telegram in real-time
- [ ] Entity database has ≥10,000 labels (verified by count query)
- [ ] 5 known whale addresses resolve to correct entity (spot-check)
- [ ] Wallet leaderboard shows top 50 wallets by PnL
- [ ] Derivatives page shows funding rates for top 20 perpetual pairs
- [ ] Derivatives page shows open interest for BTC and ETH
- [ ] Degraded modules skip to fallback within 1 request cycle
- [ ] Module cache survives process restart (Redis-backed)
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds

### Rollback Strategy

- **Telegram bot:** Independent service — disable by stopping the bot process.
- **Entity labels:** Database migration — revert by deleting imported labels (keep seed data).
- **PnL tracking:** New database table — drop table to revert.
- **Derivatives:** New page + API route — remove route and page to revert.
- **Circuit breaker / Redis cache:** Modify existing files — revert individual commits.

---

## Sprint 2 — Data Depth: Correlations, Signals, Macro

**Duration:** 2 weeks · **Goal:** Build the intelligence layer that differentiates NEXUS

### Why This Sprint

Sprint 1 gives us data. Sprint 2 makes it intelligent. The correlation engine and backtested signals are what turn raw data into actionable trading edge.

### Tasks

| # | Task | Gap | Effort | Owner |
|---|------|-----|--------|-------|
| 2.1 | **Correlation Engine** — Build PostgreSQL-backed correlation calculator. Track: (1) whale accumulation → 7d/30d price change, (2) smart money flow → direction, (3) funding rate → position change, (4) DEX volume spike → whale activity. Calculate Pearson correlation coefficients. Store results with timestamps. | GAP-007 | 5d | Backend |
| 2.2 | **Backtested Signal Library** — Store every signal with timestamp. After 30/60/90 days, calculate accuracy (% profitable). Display historical accuracy on each signal type. Build signal leaderboard. | GAP-008 | 3d | Backend |
| 2.3 | **On-Chain Macro Metrics** — Calculate MVRV (Market Cap / Realized Cap), SOPR (spent output value / created output value), NVT (Market Cap / Daily Tx Volume) from Blockstream UTXO data. Display on new `/macro-onchain` page. | GAP-005 | 3d | Full-stack |
| 2.4 | **Twitter/X Sentiment** — Monitor top 50 crypto influencer accounts via Twitter API (free tier: 1,500 tweets/month) or RSS/Nitter feeds. Calculate sentiment score per token. Correlate with whale accumulation. | GAP-004 | 2d | Backend |
| 2.5 | **Fix Rate Limiter Fail-Open** — Change rate-limit.ts to fail closed (deny) or fall back to in-memory when Redis is unavailable. | BUG-008 | 0.5d | Backend |

**Total: 13.5 days**

### Free API Sources

| Data | Source | Auth Required |
|------|--------|---------------|
| UTXO data | Blockstream API (already integrated) | No |
| Realized price | Calculated from Blockstream UTXO | No |
| Twitter sentiment | Twitter API v2 (free tier) or Nitter RSS | Free API key |
| Historical prices | CoinGecko `/coins/{id}/market_chart` | No |
| Signal accuracy | Self-calculated from stored signals | N/A |

### Definition of Done

- [ ] Correlation page shows whale accumulation → price correlation with p-value
- [ ] Signal leaderboard shows historical accuracy for each signal type
- [ ] MVRV, SOPR, NVT displayed on macro-onchain page with historical charts
- [ ] Twitter sentiment score available for top 20 tokens
- [ ] Rate limiter denies requests when Redis is down (not allows all)
- [ ] Correlation coefficients are statistically significant (p < 0.05) or flagged as inconclusive
- [ ] `npm run test` passes (new tests for correlation engine)

### Rollback Strategy

- **Correlation engine:** New table + page — drop to revert.
- **Backtested signals:** Modify signal storage — revert signal-engine.ts.
- **Macro metrics:** New page + calculation module — remove to revert.
- **Twitter sentiment:** New module — deregister to revert.
- **Rate limiter:** Single file change — revert rate-limit.ts.

---

## Sprint 3 — AI Layer: Signal Conclusions, Edge Report

**Duration:** 2 weeks · **Goal:** Make every signal explainable and actionable

### Why This Sprint

Traders need clear BUY/SELL/WATCH signals with confidence scores and explanations. This is the "last mile" that turns data into decisions.

### Tasks

| # | Task | Gap | Effort | Owner |
|---|------|-----|--------|-------|
| 3.1 | **Signal Confidence Scores** — Calculate confidence = (correct predictions / total predictions) × 100 per signal type. Display as percentage on every signal. Weight composite score by confidence. | GAP-014 | 2d | Backend |
| 3.2 | **Daily Edge Report** — Automated daily report combining top signals across all categories (whale, smart money, macro, derivatives, sentiment). Each signal includes: asset, direction, confidence, explanation, risk/reward estimate. Published to Telegram + API. | GAP-014 | 3d | Full-stack |
| 3.3 | **Copy Trading Signals** — Monitor top smart money wallets in real-time. When a smart wallet swaps, surface as "copy trade signal" with wallet PnL history and confidence score. | GAP-012 | 3d | Full-stack |
| 3.4 | **AI Signal Explanations** — For each signal, generate a human-readable explanation: "Whale 0x742d accumulated 500 ETH ($1.9M) on Binance. Historical accuracy of this signal: 72%. Similar past moves led to 15% average gain in 7 days." | GAP-014 | 2d | Backend |
| 3.5 | **Persist Alerts to PostgreSQL** — Move alert-engine.ts from in-memory Map to Prisma (Alert model already exists in schema). | BUG-026 | 1d | Backend |
| 3.6 | **Code Splitting** — Break page.tsx into route-based chunks. Lazy-load chart libraries (react-grid-layout, lightweight-charts). Extract inline styles. Target: LCP <2s on 4G. | BUG-007 | 3d | Frontend |

**Total: 14 days**

### Free API Sources

| Data | Source | Auth Required |
|------|--------|---------------|
| Signal accuracy | Self-calculated (Sprint 2 backtesting) | N/A |
| Edge Report | Aggregated from all internal signals | N/A |
| Copy trade data | On-chain tx monitoring (existing indexer) | N/A |
| AI explanations | Template-based (no LLM required) | N/A |

### Definition of Done

- [ ] Every signal shows confidence score (0-100%)
- [ ] Daily Edge Report published to Telegram at 08:00 UTC
- [ ] Daily Edge Report accessible via `GET /api/v1/edge-report`
- [ ] Copy trade signals surface within 30s of on-chain confirmation
- [ ] Every signal has human-readable explanation
- [ ] Alerts survive process restart (PostgreSQL-backed)
- [ ] Lighthouse LCP <2s on throttled 4G
- [ ] `npm run build` succeeds with no warnings

### Rollback Strategy

- **Confidence scores:** Modify signal calculation — revert signal-engine.ts.
- **Edge Report:** New endpoint — remove route to revert.
- **Copy trading:** New module — deregister to revert.
- **AI explanations:** Template-based — remove explanation generation.
- **Alert persistence:** Modify alert-engine.ts — revert to in-memory.
- **Code splitting:** Large refactor — keep monolithic page.tsx as fallback.

---

## Sprint 4 — Accessibility: Telegram, Public API, Mobile, Docker

**Duration:** 2 weeks · **Goal:** Make NEXUS free, accessible, and self-hostable for everyone

### Why This Sprint

The mission is "free for all traders." This sprint removes every barrier to entry.

### Tasks

| # | Task | Gap | Effort | Owner |
|---|------|-----|--------|-------|
| 4.1 | **Full Public API (No Key Required)** — Make all read-only `/api/v1/*` endpoints public. Keep auth only for write endpoints (alerts, cron, user settings). Add rate limiting per IP for public access. | GAP-006 (DeFiLlama parity) | 2d | Backend |
| 4.2 | **Mobile UX Optimization** — Audit all pages for mobile responsiveness. Fix horizontal scroll issues. Optimize touch targets. Test on iPhone SE viewport (375px). | Multiple gaps | 3d | Frontend |
| 4.3 | **Telegram Bot Expansion** — Add: `/whale` (recent whale moves), `/smart` (smart money signals), `/pnl:ADDRESS` (wallet PnL lookup), `/edge` (daily edge report), `/price:BTC` (price check). | GAP-002 | 2d | Backend |
| 4.4 | **Docker Self-Host Guide** — Update docker-compose.yml for one-command deployment. Write README section for self-hosting. Ensure zero external API dependencies for core features. | Constraint | 1d | DevOps |
| 4.5 | **Status Page** — Build `/status` page showing: service health (web, ws, indexer), data source freshness, chain sync status, last alert time. | Reliability pillar | 2d | Full-stack |
| 4.6 | **Mempool Intelligence** — Monitor mempool.space API for large pending BTC transactions. Flag pending transactions >$100K as pre-confirmation alerts. | GAP-015 | 2d | Backend |
| 4.7 | **Wallet Cluster Visualization** — D3.js force-directed graph showing wallet relationships based on shared transactions and common funding. | GAP-009 | 3d | Frontend |

**Total: 15 days**

### Free API Sources

| Data | Source | Auth Required |
|------|--------|---------------|
| Public API data | All existing free sources | No |
| Mobile testing | Chrome DevTools device emulation | N/A |
| Mempool data | mempool.space API | No |
| Wallet relationships | On-chain tx analysis (self-calculated) | No |
| Status monitoring | Internal health endpoints | No |

### Definition of Done

- [ ] All read-only API endpoints accessible without API key
- [ ] Rate limiting: 100 req/min per IP for public access
- [ ] All pages render correctly at 375px width (iPhone SE)
- [ ] No horizontal scroll on any page at mobile viewport
- [ ] Telegram bot supports 6+ commands
- [ ] `docker compose up --build` deploys full stack in <10 minutes
- [ ] Self-host requires zero API keys for core features
- [ ] `/status` page shows real-time health of all services
- [ ] Mempool alerts surface pending whale BTC transactions
- [ ] Wallet cluster visualization renders for top 100 entities
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds

### Rollback Strategy

- **Public API:** Revert middleware.ts PUBLIC_API_ROUTES changes.
- **Mobile UX:** CSS/component changes — revert individual files.
- **Telegram expansion:** Additive — remove new commands.
- **Docker:** Revert docker-compose.yml and README.
- **Status page:** New page — remove to revert.
- **Mempool:** New module — deregister to revert.
- **Cluster viz:** New page — remove to revert.

---

## Sprint Summary

| Sprint | Duration | Focus | Key Deliverables | Effort |
|--------|----------|-------|------------------|--------|
| Sprint 0 | 1 week | Security + Correctness | Auth fixes, SSRF fix, injection fix, USD conversion | 22.5h |
| Sprint 1 | 2 weeks | Top 5 Competitive Gaps | Telegram bot, entity expansion, PnL tracking, derivatives | 13d |
| Sprint 2 | 2 weeks | Data Intelligence | Correlation engine, backtested signals, macro metrics | 13.5d |
| Sprint 3 | 2 weeks | AI Layer | Confidence scores, Edge Report, copy trading, code split | 14d |
| Sprint 4 | 2 weeks | Accessibility | Public API, mobile UX, Docker self-host, mempool | 15d |

**Total: 9 weeks (1 developer) or 4 weeks (3 developers parallel)**

---

## Success Metrics (End of Sprint 4)

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Bug rate | 26 bugs | 0 | QA_AUDIT_REPORT.md |
| Security vulnerabilities | 7 CRITICAL | 0 | Security audit |
| Entity labels | ~118 | 10,000+ | DB count query |
| Tracked chains | 6 | 6+ (stable) | Indexer health |
| Signal accuracy tracking | None | 90-day backtest | Signal leaderboard |
| Telegram subscribers | 0 | 1,000+ | Bot stats |
| API endpoints (free) | ~15 public | All read-only public | Middleware config |
| Lighthouse LCP (mobile) | >5s | <2s | Lighthouse audit |
| Docker deploy time | N/A | <10 min | `time docker compose up` |
| Uptime monitoring | None | 24/7 health checks | Status page |
| Correlation engine | None | 4 correlation types | Correlation page |
| Signal confidence | None | 0-100% per signal | Signal display |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Free RPC rate limits (publicnode.com) | Indexer goes offline | Add fallback RPCs (Ankr, CloudFlare, LlamaNodes) |
| Telegram Bot API rate limits | Alerts delayed | Batch alerts, respect 30 msg/sec limit |
| Entity label accuracy | Wrong attribution | Verify against multiple sources, flag unverified |
| PostgreSQL storage growth | Disk fills up | Add TTL on transactions table (90 days), archive to ClickHouse |
| DeFiLlama API changes | Data breaks | Monitor DeFiLlama changelog, add circuit breaker |
| Mobile UX regressions | Broken on phones | Add Playwright mobile viewport tests |

---

## Architecture Decisions (ADRs)

### ADR-001: Telegram Bot as Separate Process

**Decision:** Run Telegram bot as a separate Node.js process (like the WS sidecar), not inside the Next.js app.
**Rationale:** Separation of concerns. Bot crashes don't affect the web app. Independent scaling.
**Consequence:** Need Redis Pub/Sub to bridge alerts from indexer to bot.

### ADR-002: PostgreSQL for Correlations (Not ClickHouse)

**Decision:** Store correlation data in PostgreSQL, not ClickHouse.
**Rationale:** Correlation calculations are batch jobs (run daily), not real-time queries. PostgreSQL is sufficient for the data volume. ClickHouse adds operational complexity.
**Consequence:** If correlation queries become slow (>1s), migrate to ClickHouse.

### ADR-003: Template-Based Signal Explanations (Not LLM)

**Decision:** Generate signal explanations using templates, not LLM API calls.
**Rationale:** LLM calls cost money and add latency. Templates are deterministic, fast, and free. Every trader gets the same explanation for the same signal.
**Consequence:** Explanations are less flexible but more trustworthy. Can add LLM enhancement later as optional.

### ADR-004: Free-First, Enhanced-Optional

**Decision:** All core intelligence must work with zero API keys. Enhanced features (Alchemy, Helius, Etherscan) are optional upgrades.
**Rationale:** The platform mission is "free for all traders." No trader should be blocked by a paywall.
**Consequence:** Free RPC endpoints have rate limits. Need fallback chains and graceful degradation.

---

*Roadmap generated 2026-06-20. Based on QA_AUDIT_REPORT.md (26 bugs) and COMPETITIVE_GAP_ANALYSIS.md (18 gaps). All tasks have verified free API sources and rollback strategies.*
