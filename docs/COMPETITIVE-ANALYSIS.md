# 1AI NEXUS — Competitive Gap Analysis & Product Map
> **Date:** 2026-06-20 · **Repo:** oyi77/1ai-nexus · **Live:** tracker.aitradepulse.com

---

## Competitor Landscape

| Platform | Core Strength | Data Depth | Price | Our Gap |
|----------|--------------|------------|-------|---------|
| **Nansen** | 500M+ wallet labels, Smart Money tracking | ClickHouse, petabytes | $150+/mo | Entity DB: 118 vs 500M |
| **Arkham** | Entity deanonymization, Intel Exchange | Ultra AI ML engine | Freemium | No ML-based attribution |
| **GMGN** | Sub-second token discovery, copy trading | Real-time DEX scanning | Free | No sniper speed, no copy trading |
| **Hyperdash** | Hyperliquid derivatives terminal | Real-time liquidation heatmaps | Free | Basic derivatives only |
| **Bloomberg** | 35M instruments, 330+ exchanges | 20+ years historical | $32K/yr | No historical data, no charting |
| **OpenBB** | 35+ providers, 500+ fetchers | Modular TET pipeline | Free/OSS | Architecture reference |
| **DeFiLlama** | 10K+ protocol scrapers | Open-source adapters | Free | Already integrated |
| **CryptoQuant** | Exchange flow, macro signals | On-chain analytics | Freemium | No exchange flow tracking |

---

## Gap Analysis (Ranked by Impact)

### 🔴 CRITICAL — Blocks Vilona Trading Agent

| # | Gap | Impact | Effort | Source |
|---|-----|--------|--------|--------|
| 1 | **No historical data storage** | Can't backtest, chart trends, compute indicators | 2d | PostgreSQL snapshots |
| 2 | **No real-time WebSocket streaming** | 60s stale prices vs sub-second | 1d | Binance/CoinCap WS |
| 3 | **No OHLCV candle construction** | Can't render charts, compute MA/RSI/MACD | 1d | From snapshots |
| 4 | **Entity DB too small (118)** | Smart money scoring is meaningless | 2d | Open Labels Initiative, Dune |
| 5 | **No exchange flow tracking** | Can't detect whale deposits/withdrawals | 1d | CryptoQuant-style via on-chain |
| 6 | **No sentiment scoring on news** | Can't quantify news impact | 0.5d | Keyword NLP (done) + LLM |

### 🟡 IMPORTANT — Competitive Parity

| # | Gap | Impact | Effort | Source |
|---|-----|--------|--------|--------|
| 7 | **No technical indicators** | Can't compute RSI, MACD, Bollinger | 1d | From OHLCV data |
| 8 | **No multi-chain entity resolution** | Same entity on ETH ≠ SOL | 1d | Behavioral clustering |
| 9 | **No whale alert delivery** | Alerts exist but no Telegram/webhook | 0.5d | Webhook (done) + Telegram |
| 10 | **No DEX volume tracking** | Can't see which DEXs are hot | 0.5d | DeFiLlama DEX endpoint |
| 11 | **No stablecoin supply tracking** | Can't detect capital flows | 0.5d | DeFiLlama stablecoins |
| 12 | **No bridge flow tracking** | Can't see cross-chain capital movement | 0.5d | DeFiLlama bridges |
| 13 | **No fee/revenue tracking** | Can't rank protocols by revenue | 0.5d | DeFiLlama fees |

### 🟢 NICE TO HAVE — Differentiation

| # | Gap | Impact | Effort | Source |
|---|-----|--------|--------|--------|
| 14 | **No copy trading** | Can't mirror smart money | 2d | On-chain tx monitoring |
| 15 | **No MEV detection** | Can't identify sandwich attacks | 1d | On-chain pattern matching |
| 16 | **No governance tracking** | Can't monitor DAO votes | 1d | Snapshot API |
| 17 | **No NFT analytics** | Can't track NFT whale activity | 1d | OpenSea/Blur APIs |

---

## Open-Source References

| Repo | What to Steal | URL |
|------|--------------|-----|
| **OpenBB** | TET pipeline pattern, provider registry | github.com/OpenBB-finance/OpenBB |
| **DeFiLlama-Adapters** | Adapter pattern, multicall batching | github.com/DefiLlama/DefiLlama-Adapters |
| **GraphSense** | Entity clustering algorithms | github.com/graphsense/graphsense |
| **BlockSci** | High-performance blockchain parsing | github.com/citp/BlockSci |
| **Open Labels Initiative** | Community wallet labels | github.com/openlabelsinitiative/OLI |
| **feremabraz/bloomberg-terminal** | Bloomberg UI clone (Next.js) | github.com/feremabraz/bloomberg-terminal |
| **SAY-5/sigma-terminal** | Canvas charts + WebSocket | github.com/SAY-5/sigma-terminal |
| **GMGN Skills** | OpenAPI for smart money data | github.com/GMGNAI/gmgn-skills |
| **Freqtrade** | Exchange integration via CCXT | github.com/freqtrade/freqtrade |
| **Cryptofeed** | 60+ exchange WebSocket handler | github.com/bmoscon/cryptofeed |

---

## Implementation Plan (Ordered by Impact)

### Phase 1: Historical Data + Charts (3 days)
- [ ] PostgreSQL price snapshot table (symbol, price, volume, timestamp)
- [ ] Snapshot cron: CoinGecko every 60s for 50+ assets
- [ ] OHLCV candle builder from snapshots (1m/5m/15m/1h/4h/1d)
- [ ] Technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands
- [ ] Wire lightweight-charts to real OHLCV data
- [ ] GET /api/v1/ohlvc?symbol=BTC&interval=1h&limit=100

### Phase 2: Entity Expansion (2 days)
- [ ] Import Open Labels Initiative dataset (1000+ labels)
- [ ] Import Dune community labels (exchange wallets, VC funds)
- [ ] Add Solana entity labels (Raydium, Jupiter, Marinade wallets)
- [ ] Add Bitcoin entity labels (mining pools, exchanges)
- [ ] Smart money scoring: win rate, PnL percentile, early mover score

### Phase 3: DeFi Intelligence (1 day)
- [ ] DEX volume tracking (DeFiLlama /overview/dex)
- [ ] Stablecoin supply tracking (DeFiLlama stablecoins)
- [ ] Bridge flow tracking (DeFiLlama bridges)
- [ ] Fee/revenue tracking (DeFiLlama fees)
- [ ] Yield ranking with risk ratings

### Phase 4: Exchange Flow + Whale Detection (1 day)
- [ ] Exchange deposit/withdrawal detection via on-chain patterns
- [ ] Whale movement prediction (exchange deposit spikes)
- [ ] Large transfer alerts (>$1M)
- [ ] Exchange netflow dashboard

### Phase 5: MCP Tools Expansion (1 day)
- [ ] Expose all new data via MCP tools
- [ ] Add query_ohlvc, query_indicators, query_entity, query_flow tools
- [ ] Document MCP tool schema for Vilona consumption

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Entity labels | 118 | 1,000+ |
| Tracked assets | 18 | 50+ |
| Historical depth | 0 | 30 days |
| Data sources | 34 modules | 40+ modules |
| OHLCV intervals | 0 | 6 |
| Technical indicators | 0 | 5 |
| RSS feeds | 60+ | 60+ ✓ |
| MCP tools | 12 | 20+ |
