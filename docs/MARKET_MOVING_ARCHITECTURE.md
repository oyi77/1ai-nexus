# NEXUS Market-Moving Data Expansion — Architecture Note

## Step 0 Audit Findings

### 1. Existing Data Sources
NEXUS currently ingests:
- **Price/Candles**: OHLCV from Binance (crypto) and Yahoo Finance (equities/forex/commodities)
- **Derivatives**: Funding rates, open interest from Binance Futures
- **Sentiment**: Fear & Greed Index from alternative.me
- **On-chain**: Whale alerts, exchange flows, liquidations (via internal APIs)
- **News**: RSS feeds, GDELT
- **Macro**: FRED economic data
- **DEX**: DexScreener, GeckoTerminal

### 2. Provider Interface
Existing pattern: `OHLCVProvider` in `src/lib/modules/market/types.ts`
```typescript
export interface OHLCVProvider {
  id: string
  name: string
  supports: ('crypto' | 'equity' | 'forex' | 'commodity' | 'index')[]
  fetchOHLCV(req: OHLCVRequest): Promise<OHLCVResponse>
  healthCheck(): Promise<boolean>
}
```

**Decision**: Extend this pattern for market-moving signals with a new `MarketDataProvider` interface that adds:
- `tier: SignalTier` — categorization for fusion scoring
- `fetchSignal()` — returns normalized signal with human-readable explanation
- `isEnabled()` — config-driven per vertical

### 3. Caching Strategy
Two-layer cache: in-memory Map + Redis, with `getCached(key, ttlMs, fetcher)` pattern.

**Decision**: Reuse this pattern. TTL per provider matched to data cadence:
- Order book: 5s
- Funding rate: 5min
- OI: 1min
- On-chain: 15min
- Sentiment: 5min

### 4. Config Mechanism
No existing per-vertical config. Environment variables for API keys.

**Decision**: Create `src/lib/config/market-sources.ts` with enable/disable per provider per vertical.

### 5. Signal → UI Pipeline
Current: Alpha Engine → `getAlphaSignals()` → API → Frontend
Signals have: symbol, direction, strength, confidence, sources[], reasoning

**Decision**: Extend alpha-engine to consume `NormalizedSignal` from new providers, feed into composite score.

---

## Implementation Plan

### Phase 1 (Tier 1) — Order Flow & Derivatives
1. `provider/binance-funding/` — Funding rate + delta
2. `provider/binance-oi/` — Open interest + delta
3. `provider/binance-liquidations/` — Liquidation feed
4. `provider/binance-ls-ratio/` — Long/short ratio
5. `provider/binance-orderbook/` — L2 depth & imbalance
6. `provider/deribit-options/` — Options positioning
7. `provider/alternative-me/` — Fear & Greed (exists, extend)
8. `provider/fred-calendar/` — Economic calendar

### Phase 2 (Tier 2) — On-chain
9. `provider/cryptoquant/` — Exchange net flow
10. `provider/stablecoin-flow/` — Stablecoin supply (extend existing)
11. `provider/whale-alert/` — Whale transfers (extend existing)

### Phase 3 — Signal Fusion
12. `src/lib/modules/derived/market-moving-score.ts` — Composite scorer
13. `src/app/api/v1/market-score/route.ts` — API endpoint
14. `src/app/market-score/page.tsx` — UI component

### Phase 4 — Validation
15. `scripts/backtest-signals.ts` — Signal correlation backtest
