# Gap Analysis
> Platform: 1ai-nexus | Target: 2B IDR/year Bloomberg competitor | Updated: 2026-06-30
> Read with: FEATURE_MATRIX.md

## Pricing Context
- Our price: 2B IDR/year (~$125K)
- Bloomberg Terminal: $24K/year (~384M IDR)
- TradingView Premium: $600/year (~9.6M IDR)
- **We are priced at 5x Bloomberg.** Every gap must be closed or we must have a 5x better answer in on-chain + Indonesian market.

## Scoreboard
- Total features tracked: 50
- Our ✅/⭐: 22 (44%)
- Our ❌: 20 (40%)
- Our 🚧: 8 (16%)
- **P0 open: 5** | **P1 open: 11** | **P2 open: 3**

---

## P0 — Critical Gaps (fix before any sales pitch)

### GAP-001: IDX / IHSG Integration
- **Status:** ❌
- **Competitors who have it:** Bloomberg (⭐), Refinitiv (⭐), TradingView (🚧)
- **User impact:** Indonesian trading desks CANNOT use a terminal that doesn't show IHSG, LQ45, IDX30, and individual IDX stocks (BBCA.JK, BBRI.JK, BMRI.JK, etc.)
- **User evidence:** RTI Business and Stockbit are the default for Indonesian retail. Professional desks use Bloomberg/Refinitiv for IDX.
- **Done looks like:** Real-time IDX index quotes, top 45 stocks by market cap, sector breakdown, individual stock pages with fundamentals
- **Data source:** Yahoo Finance (BBCA.JK already works in codebase), RTI Business (scrape), or IDX API
- **Effort:** M
- **Sprint:** Next
- **Closed:** [ ]

### GAP-002: IDR Forex Pairs
- **Status:** ❌
- **Competitors who have it:** Bloomberg (⭐), Refinitiv (⭐), TradingView (✅), Trading Economics (⭐)
- **User impact:** Indonesian desks trade USD/IDR daily. Without it, the terminal is useless for FX desks.
- **Done looks like:** USD/IDR, EUR/IDR, JPY/IDR, SGD/IDR with real-time quotes, charts, and historical data
- **Data source:** Yahoo Finance (USDIDR=X), Frankfurter API (free), ECB (free)
- **Effort:** S
- **Sprint:** Next
- **Closed:** [ ]

### GAP-003: Indonesian Macro Data
- **Status:** ❌
- **Competitors who have it:** Bloomberg (⭐), Refinitiv (⭐), Trading Economics (⭐)
- **User impact:** BI Rate, Indonesian CPI, Indonesian GDP, trade balance — essential for macro analysis at Indonesian desks
- **Done looks like:** Macro Hub showing Indonesian indicators alongside US indicators, with charts and latest values
- **Data source:** World Bank (already works for US), Bank Indonesia API (free), BPS Indonesia (free), Trading Economics (scrape)
- **Effort:** M
- **Sprint:** Next
- **Closed:** [ ]

### GAP-004: Technical Indicators on Charts
- **Status:** ❌
- **Competitors who have it:** Bloomberg (⭐), TradingView (⭐), Refinitiv (⭐), Koyfin (✅)
- **User impact:** No trader will use a terminal without RSI, MACD, Bollinger Bands, Moving Averages on charts
- **Done looks like:** 20+ indicators overlayable on any chart, with customizable parameters
- **Data source:** Calculate from OHLCV data (no external API needed)
- **Effort:** M (use lightweight-charts library which supports indicators)
- **Sprint:** Next
- **Closed:** [ ]

### GAP-005: Multi-Asset Screener
- **Status:** ❌
- **Competitors who have it:** Bloomberg (⭐), TradingView (⭐), Refinitiv (⭐), Koyfin (✅)
- **User impact:** VCs and family offices need to screen stocks by PE, market cap, sector, dividend yield, etc.
- **Done looks like:** Filter equities, forex, commodities by 20+ criteria, with sortable results table
- **Data source:** Yahoo Finance (already in codebase), FinViz (free scrape)
- **Effort:** M
- **Sprint:** Next
- **Closed:** [ ]

---

## P1 — Strategic Gaps (surpass, not just match)

### GAP-006: Indonesian Government Bonds (SUN)
- **Status:** ❌
- **Best competitor version:** Bloomberg — full bond pricing, yield curves, spread analysis
- **Data source:** IDX Bond Board (scrape), or KSEI (Indonesian CSD)
- **Effort:** L
- **Closed:** [ ]

### GAP-007: Options Analytics
- **Status:** ❌
- **Best competitor version:** Bloomberg OVDV — volatility surface, Greeks, strategy builder
- **Effort:** XL
- **Closed:** [ ]

### GAP-008: Portfolio Risk Management
- **Status:** 🚧 (basic PnL tracker exists)
- **Best competitor version:** Bloomberg PORT — VaR, Sharpe, attribution, factor analysis
- **Effort:** L
- **Closed:** [ ]

### GAP-009: Drawing Tools on Charts
- **Status:** ❌
- **Best competitor version:** TradingView — trendlines, fibonacci, rectangles, text annotations
- **Effort:** M (lightweight-charts has drawing plugin)
- **Closed:** [ ]

### GAP-010: Multi-Panel Chart Layouts
- **Status:** ❌
- **Best competitor version:** TradingView — up to 8 charts in one view, linked cursors
- **Effort:** M
- **Closed:** [ ]

### GAP-011: Indonesian Language Support
- **Status:** ❌
- **User impact:** Indonesian desks expect Bahasa Indonesia UI
- **Effort:** M (i18n framework + translation)
- **Closed:** [ ]

### GAP-012: WhatsApp/Telegram Alert Integration
- **Status:** 🚧 (Telegram bot exists, no WhatsApp)
- **User impact:** Indonesian traders live on WhatsApp. Alerts must reach them there.
- **Data source:** WhatsApp Business API (paid) or Twilio
- **Effort:** M
- **Closed:** [ ]

### GAP-013: Company Fundamentals
- **Status:** ❌
- **Best competitor version:** Bloomberg — full financial statements, ratios, estimates
- **Data source:** Yahoo Finance (already in codebase), SEC EDGAR (free), IDX disclosures
- **Effort:** M
- **Closed:** [ ]

### GAP-014: Heatmap Visualization
- **Status:** ❌
- **Best competitor version:** FinViz — sector heatmap, market map
- **Effort:** S (D3 treemap)
- **Closed:** [ ]

### GAP-015: Backtesting Engine
- **Status:** ❌
- **Best competitor version:** TradingView Pine Script — full strategy backtesting
- **Effort:** XL
- **Closed:** [ ]

### GAP-016: Mobile App / PWA
- **Status:** ❌ (PWA manifest exists but incomplete)
- **User impact:** Indonesian traders check markets on mobile during commute
- **Effort:** M (complete PWA setup)
- **Closed:** [ ]

---

## P2 — Moat Opportunities (differentiators)

### MOAT-005: AI-Powered Market Commentary
- **Source of insight:** LLM summarizes cross-asset moves daily in Bahasa Indonesia
- **Why competitors haven't done it:** Bloomberg has BloombergGPT but it's internal-only
- **Our edge:** We have LLM integration + multi-asset data + Indonesian language
- **Effort:** M
- **Closed:** [ ]

### MOAT-006: Indonesian VC Deal Flow Intelligence
- **Source of insight:** Scrape IDX filings, OJK regulations, startup funding rounds
- **Why competitors haven't done it:** Bloomberg doesn't focus on Indonesian VC/PE
- **Effort:** L
- **Closed:** [ ]

### MOAT-007: Cross-Asset Correlation Engine
- **Source of insight:** Real-time correlation matrix across equities, FX, commodities, crypto, bonds
- **Why competitors haven't done it:** Each competitor covers their own silo
- **Our edge:** We have ALL asset classes under one roof
- **Effort:** M
- **Closed:** [ ]

---

## Revenue Justification

To sell at 2B IDR/year, the pitch must be:

> "Bloomberg costs $24K/year and doesn't cover crypto or Indonesian VC intelligence.
> TradingView costs $600/year but has no on-chain data, no macro analytics, no alerts.
> Nexus gives you ALL of this in one terminal: US + IDX equities, forex, commodities,
> 22 macro indicators, 58 on-chain modules, real-time alerts, and AI-powered insights.
> Plus it's self-hosted — your data never leaves your servers."

**This pitch only works after P0 gaps are closed.** Without IDX, IDR forex, and Indonesian macro, Indonesian desks won't even evaluate us.

## Implementation Priority

```
Sprint 1 (P0 — must close before any sales call):
  GAP-002: IDR Forex (S — 1 day)
  GAP-001: IDX/IHSG (M — 3 days)
  GAP-003: Indonesian Macro (M — 3 days)
  GAP-004: Technical Indicators (M — 3 days)
  GAP-005: Multi-Asset Screener (M — 3 days)

Sprint 2 (P1 — close to justify premium):
  GAP-009: Drawing Tools (M)
  GAP-014: Heatmap (S)
  GAP-013: Company Fundamentals (M)
  GAP-011: Indonesian Language (M)
  GAP-016: PWA Mobile (M)

Sprint 3 (P1 — close to match Bloomberg):
  GAP-006: SUN Bonds (L)
  GAP-008: Portfolio Risk (L)
  GAP-010: Multi-Panel Charts (M)
  GAP-012: WhatsApp Alerts (M)
  GAP-015: Backtesting (XL)
```
