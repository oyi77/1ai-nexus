# NEXUS CEX Data Architecture Plan

**Author:** Architecture Review  
**Date:** 2025  
**Status:** Ready for Implementation  
**Priority:** P0 - Core Signal for Whale Tracking

---

## Executive Summary

This document outlines a complete CEX data integration strategy for NEXUS. We're adding **real-time exchange data** (spot prices, funding rates, liquidations, open interest) across 5 major CEXs—all with **zero API keys required**.

**Key Decisions:**
- **Architecture:** Unified `cex.ts` client with per-exchange adapters (not monolithic)
- **Real-time:** WebSocket streams in indexer; REST fallback for API route caching
- **Data Model:** 6 normalized types (Exchange, Pair, FundingRate, OpenInterest, Liquidation, FlowMetrics)
- **Implementation Order:** Binance → Bybit → OKX → Hyperliquid → Kraken
- **Signal Quality:** High (funding rates + liquidations are top-10 whale activity indicators)

---

## 1. Why CEX Data Matters for Whale Tracking

### Signal Hierarchy

| Signal | Source | Whale Relevance | Real-time? | Latency Target |
|--------|--------|-----------------|------------|-----------------|
| **Liquidations** | Bybit, OKX, Hyperliquid | ⭐⭐⭐⭐⭐ | Yes | <5s |
| **Funding Rates** | All major CEXs | ⭐⭐⭐⭐⭐ | Yes | <30s |
| **Exchange Flows** | On-chain (existing) | ⭐⭐⭐⭐ | No | 60s |
| **Open Interest Spikes** | All major CEXs | ⭐⭐⭐⭐ | Yes | <30s |
| **Long/Short Ratio** | Binance, Bybit, OKX | ⭐⭐⭐ | No | 300s |
| **Spot Price Arbitrage** | All major CEXs | ⭐⭐⭐ | No | 60s |
| **Exchange Volume Distribution** | All major CEXs | ⭐⭐ | No | 300s |

### Why These Signals Work

1. **Liquidations** = Forced selling/buying; reveals margin positions; precedes flash crashes
2. **Funding Rates** = Real money betting; positive rates = long pressure; negative = short pressure
3. **OI Spikes** = Capital entering futures markets; often precedes volatility
4. **Spot Prices** = Arbitrage opportunities signal market microstructure inefficiencies

---

## 2. CEX Selection & Ranking

### Final Tier 1 (Implement First)

| Exchange | Free Public API | No-Auth Endpoints | WebSocket | Rate Limits | Signal Quality | Implementation Effort | **Priority** |
|----------|-----------------|-------------------|-----------|-------------|-----------------|----------------------|----------|
| **Binance** | ✅ Yes | ✅ Yes (public) | ✅ Yes | 1200/min | ⭐⭐⭐⭐⭐ | Low | **P0** |
| **Bybit** | ✅ Yes | ✅ Yes | ✅ Yes | 1000/min | ⭐⭐⭐⭐⭐ | Low | **P0** |
| **OKX** | ✅ Yes | ✅ Yes | ✅ Yes | 30/sec | ⭐⭐⭐⭐ | Medium | **P1** |
| **Hyperliquid** | ✅ Yes | ✅ Yes | ✅ Yes | Unlimited | ⭐⭐⭐⭐ | Medium | **P1** |
| **Kraken** | ⚠️ Partial | ⚠️ Limited | ✅ Yes | 15/sec | ⭐⭐⭐ | Medium | **P2** |

### Why NOT Others

- **Gate.io**: Spotty API docs, rate limiting issues, less liquidity
- **Huobi**: Declining liquidity, legacy API
- **Deribit**: Options-only, different data model
- **FTX/Alameda**: Defunct (not a real option)
- **Coinbase**: Requires API key (breaks zero-API philosophy)
- **Kucoin**: Requires API key for most endpoints

---

## 3. API Endpoint Reference (No Auth Required)

### 3.1 BINANCE

**Base URLs:**
```
REST: https://api.binance.com (market data)
WebSocket: wss://stream.binance.com:9443/ws
WebSocket (aggregated): wss://stream.binance.com:9443/stream
```

**Key Endpoints:**

| Endpoint | Purpose | Rate Limit | Response |
|----------|---------|-----------|----------|
| `GET /api/v3/ticker/24hr` | 24h price/volume | 40/min | Symbol, price24h, volume24h, change% |
| `GET /api/v3/exchangeInfo` | Trading pairs info | 10/min | All tradeable pairs |
| `GET /api/v3/fundingRate?symbol=BTCUSDT` | Futures funding rate | 40/min | fundingRate, time |
| `GET /api/v3/openInterest?symbol=BTCUSDT` | Open interest | 40/min | openInterest, symbol |
| `GET /api/v3/trades?symbol=BTCUSDT&limit=100` | Recent spot trades | 400/min | Trades w/ qty, price, time |
| `GET /fapi/v1/fundingRate?symbol=BTCUSDT` | **USDM Futures** funding | 200/min | Per-symbol funding rate |
| `GET /fapi/v1/openInterest?symbol=BTCUSDT` | **USDM Futures** OI | 200/min | openInterest, symbol |
| `GET /fapi/v1/trades?symbol=BTCUSDT&limit=100` | **USDM Futures** trades | 400/min | trades w/ qty, price, time |

**WebSocket Streams (no auth):**
```
@aggTrade         - Aggregate trades
@klines_1m        - 1m candlestick
@ticker           - 24h ticker
@bookTicker       - Best bid/ask
@depth@100ms      - Order book depth

Example: wss://stream.binance.com:9443/ws/btcusdt@ticker
```

**Liquidation Data:**
- ❌ **Binance doesn't expose liquidation data via public API**
- Must get from liquidation events (users report their own) or third-party APIs

---

### 3.2 BYBIT

**Base URLs:**
```
REST: https://api.bybit.com (v5 is latest)
WebSocket: wss://stream.bybit.com/v5/public/spot
           wss://stream.bybit.com/v5/public/linear (USDT perpetuals)
           wss://stream.bybit.com/v5/public/inverse (Inverse perpetuals)
```

**Key Endpoints (v5 REST):**

| Endpoint | Purpose | Rate Limit | Response |
|----------|---------|-----------|----------|
| `GET /v5/market/tickers?category=spot&symbol=BTCUSDT` | Spot tickers | 10/sec | price, volume24h, change24h |
| `GET /v5/market/tickers?category=linear&symbol=BTCUSDT` | Futures tickers | 10/sec | price, openInterest, fundingRate |
| `GET /v5/market/funding/history?category=linear&symbol=BTCUSDT` | Funding rate history | 5/sec | fundingRate, fundingTime (8h intervals) |
| `GET /v5/market/open-interest?category=linear&symbol=BTCUSDT` | Open interest | 10/sec | openInterest, timestamp |
| `GET /v5/market/insurance?coin=BTC` | Insurance pool size | 10/sec | Insurance balance |
| `GET /v5/market/liquidation?category=linear&symbol=BTCUSDT` | **Liquidations** | 5/sec | qty, side, price, timestamp |
| `GET /v5/market/kline?category=spot&symbol=BTCUSDT&interval=1` | OHLCV | 10/sec | ohlcv data |
| `GET /v5/market/orderbook?category=spot&symbol=BTCUSDT` | Order book | 10/sec | bids, asks |

**WebSocket Streams (no auth):**
```
tickers.BTCUSDT           - Ticker updates
funding                   - Funding rate updates (real-time)
liquidation.BTCUSDT       - Liquidation events (REAL-TIME! 🎯)
kline.1.BTCUSDT           - 1min candlestick
orderbook.50.BTCUSDT      - Order book (top 50)
publicTrade.BTCUSDT       - Trade stream

Example: wss://stream.bybit.com/v5/public/linear
Payload: {"op":"subscribe","args":["liquidation.BTCUSDT"]}
```

---

### 3.3 OKX

**Base URLs:**
```
REST: https://www.okx.com/api/v5
WebSocket: wss://ws.okx.com:8443/ws/v5/public
           wss://ws.okx.com:8443/ws/v5/private (requires auth)
```

**Key Endpoints (v5 REST):**

| Endpoint | Purpose | Rate Limit | Response |
|----------|---------|-----------|----------|
| `GET /market/tickers?instType=SPOT&instId=BTC-USDT` | Spot tickers | 30/sec | price, 24hVolume, change% |
| `GET /market/tickers?instType=SWAP&instId=BTC-USDT-SWAP` | Perpetual tickers | 30/sec | price, openInterest, fundingRate |
| `GET /public/funding-rate?instId=BTC-USDT-SWAP` | Funding rate | 30/sec | fundingRate, nextFundingTime |
| `GET /public/funding-rate-history?instId=BTC-USDT-SWAP` | Funding history | 10/sec | fundingRate[], timestamps |
| `GET /public/open-interest?instId=BTC-USDT-SWAP` | Open interest | 30/sec | oi, oiCcy (OI in quote ccy) |
| `GET /market/liquidation-orders?instId=BTC-USDT-SWAP` | **Liquidations** | 30/sec | Details of liquidated positions |
| `GET /market/candles?instId=BTC-USDT-SWAP&bar=1m` | OHLCV | 40/sec | Candlestick data |
| `GET /market/books?instId=BTC-USDT-SWAP` | Order book | 30/sec | bids, asks |
| `GET /market/trades?instId=BTC-USDT-SWAP` | Trades | 40/sec | Recent trades |

**WebSocket Streams (no auth for public):**
```
tickers.BTC-USDT-SWAP       - Perpetual ticker updates
funding-rate.BTC-USDT-SWAP  - Funding rate updates (real-time)
liquidation-orders.SWAP.BTC-USDT-SWAP - Liquidation stream (REAL-TIME!)
candle1m.BTC-USDT-SWAP      - 1min candlestick
books50.BTC-USDT-SWAP       - Top 50 order book
trades.BTC-USDT-SWAP        - Trade stream

Example: wss://ws.okx.com:8443/ws/v5/public
Payload: {"op":"subscribe","args":[{"channel":"liquidation-orders","instType":"SWAP","instId":"BTC-USDT-SWAP"}]}
```

---

### 3.4 HYPERLIQUID

**Base URLs:**
```
REST: https://api.hyperliquid.xyz
WebSocket: wss://api.hyperliquid.xyz/ws
```

**Key Endpoints (HTTP POST):**
```json
// Request format: {"type": "action", "payload": {...}}

// Get all active markets
POST /info
{"type": "metaAndAssetCtxs"}
Response: [metadata, [assetContext, ...]]

// Get orderbook (NO AUTH NEEDED)
POST /info
{"type": "l2Book", "coin": "BTC"}
Response: {"levels": [[[price, size], ...], [[price, size], ...]]}

// Get recent trades
POST /info
{"type": "recentTrades", "coin": "BTC"}
Response: [{"px": 42000, "sz": 1.5, "side": "A", "time": timestamp, ...}, ...]

// Get funding rate
POST /info
{"type": "fundingHistory", "coin": "BTC", "startTime": <ms>}
Response: [{"fundingRate": 0.0001, "time": timestamp}, ...]

// Get open interest
POST /info
{"type": "oiHistory", "coin": "BTC", "startTime": <ms>}
Response: [{"openInterest": 50000, "time": timestamp}, ...]

// Get liquidations (NO AUTH NEEDED)
POST /info
{"type": "metaAndAssetCtxs"}
// Returns assetContext with liquidationPrice field

// Get user leverage data (requires auth - skip for now)
```

**WebSocket Streams (no auth):**
```
{"method": "subscribe", "subscription": {"type": "trades", "coin": "BTC"}}
{"method": "subscribe", "subscription": {"type": "orderbook", "coin": "BTC"}}
{"method": "subscribe", "subscription": {"type": "funding", "coin": "BTC"}} // real-time funding updates
{"method": "subscribe", "subscription": {"type": "liquidations"}} // all liquidations

Response: {"channel": "trades", "data": {"trades": [...], "coin": "BTC"}}
```

---

### 3.5 KRAKEN

**Base URLs:**
```
REST: https://api.kraken.com/0
WebSocket: wss://ws.kraken.com
           wss://ws.kraken.com?token=<token> (for private)
```

**Key Endpoints:**

| Endpoint | Purpose | Rate Limit | Response |
|----------|---------|-----------|----------|
| `GET /public/Ticker?pair=XBTUSDT,ETHUSDT` | Current prices | 15/sec | price, volume24h, VWAP |
| `GET /public/AssetPairs` | Trading pairs info | 15/sec | All pairs |
| `GET /public/OHLC?pair=XBTUSDT&interval=1` | OHLCV | 15/sec | OHLCV data |
| `GET /public/Depth?pair=XBTUSDT` | Order book | 15/sec | bids, asks |
| `GET /public/Trades?pair=XBTUSDT` | Recent trades | 15/sec | Trades with qty, price |
| `GET /public/Spread?pair=XBTUSDT` | Bid-ask spread | 15/sec | bid, ask, timestamp |

**Limitations:**
- ❌ **No free futures data** (requires API key)
- ❌ **No funding rates** via public API
- ❌ **No liquidation data** via public API
- ✅ Spot data only (lower value for whale tracking)

**WebSocket Streams (public):**
```
{"event": "subscribe", "pair": ["XBT/USD"], "subscription": {"name": "ticker"}}
{"event": "subscribe", "pair": ["XBT/USD"], "subscription": {"name": "spread"}}
{"event": "subscribe", "pair": ["XBT/USD"], "subscription": {"name": "trade"}}
{"event": "subscribe", "pair": ["XBT/USD"], "subscription": {"name": "ohlc", "interval": 1}}

Response: [0, {"b": [[price, vol, rpl, rep]], "a": [[price, vol, rpl, rep]], "c": [price, lot]}, "spread", "XBT/USD"]
```

---

## 4. Data Model & TypeScript Types

### 4.1 Core Types

```typescript
// ═══════════════════════════════════════════════════════════════
// Exchange Info
// ═══════════════════════════════════════════════════════════════

export interface CexExchange {
  id: string; // "binance", "bybit", "okx", "hyperliquid", "kraken"
  name: string; // "Binance", "Bybit", etc.
  timezone: string;
  serverTime: number;
  makerFee: number; // 0.001 = 0.1%
  takerFee: number;
  spotVolumeUsd24h: number; // estimated
  futuresVolumeUsd24h: number; // estimated
  status: "operational" | "degraded" | "offline";
  lastUpdate: number; // timestamp ms
}

// ═══════════════════════════════════════════════════════════════
// Trading Pair (Unified across exchanges)
// ═══════════════════════════════════════════════════════════════

export interface CexPair {
  // Identification
  id: `${string}_${string}`; // "binance_BTCUSDT", "bybit_BTCUSDT"
  exchange: "binance" | "bybit" | "okx" | "hyperliquid" | "kraken";
  baseSymbol: string; // "BTC"
  quoteSymbol: string; // "USDT"
  symbol: string; // "BTCUSDT" or "BTC-USDT"
  pairType: "spot" | "linear" | "inverse"; // spot, USDM futures, Inverse futures

  // Prices
  priceUsd: number;
  priceChange24hPercent: number;
  priceChange1hPercent?: number;
  priceHigh24h: number;
  priceLow24h: number;
  priceOpen24h: number; // for 24h % calc

  // Volume & Liquidity
  volumeUsd24h: number;
  volumeBase24h: number;
  bidAskSpreadBps: number; // basis points
  midPrice: number; // (bid + ask) / 2

  // Futures-only metrics
  fundingRateLatest?: number; // 0.0001 = 0.01% per 8h
  fundingRateNext?: { rate: number; timestamp: number };
  openInterestUsd?: number;
  openInterestAmount?: number; // in base units
  longPositionRatio?: number; // 0.6 = 60% longs
  shortPositionRatio?: number; // 0.4 = 40% shorts
  liquidationPriceHigh?: number; // highest liquidation price in 24h
  liquidationPriceLow?: number;

  // Exchange-specific
  isActive: boolean;
  minOrderSize: number; // in base units
  maxOrderSize: number;

  // Metadata
  lastUpdate: number; // timestamp ms
  confidence: number; // 0.0-1.0 (data freshness confidence)
}

// ═══════════════════════════════════════════════════════════════
// Funding Rate (Historical & Current)
// ═══════════════════════════════════════════════════════════════

export interface CexFundingRate {
  id: `${string}_${string}_${number}`; // "binance_BTCUSDT_1234567890"
  exchange: "binance" | "bybit" | "okx" | "hyperliquid";
  symbol: string;
  fundingRate: number; // e.g., 0.00015 = 0.015% per 8h
  fundingTimestamp: number; // when this rate was/is active
  nextFundingTime?: number;
  timestamp: number; // when we recorded it
  
  // Derived signals
  isPositive: boolean; // true = longs paying shorts (long pressure)
  magnitude: "extreme" | "high" | "normal" | "low";
  trend?: "increasing" | "decreasing" | "stable";
}

// ═══════════════════════════════════════════════════════════════
// Open Interest
// ═══════════════════════════════════════════════════════════════

export interface CexOpenInterest {
  id: `${string}_${string}_${number}`; // "bybit_BTCUSDT_1234567890"
  exchange: "binance" | "bybit" | "okx" | "hyperliquid";
  symbol: string;
  openInterestUsd: number; // total $ notional value
  openInterestAmount: number; // in base units
  timestamp: number;
  
  // Change metrics
  change24h: number; // $ amount
  change24hPercent: number;
  changeRecordedAt: number; // reference time for change calc
  
  // Whale signals
  isSpike: boolean; // true if OI > 2σ above 24h mean
  spikeRatio: number; // current / 24h_avg
}

// ═══════════════════════════════════════════════════════════════
// Liquidation (High-value whale signal)
// ═══════════════════════════════════════════════════════════════

export interface CexLiquidation {
  id: `${string}_${string}_${number}_${number}`; // composite unique id
  exchange: "bybit" | "okx" | "hyperliquid"; // only these expose it
  symbol: string;
  side: "long" | "short";
  quantity: number; // position size in base units
  liquidationPrice: number; // price at which liquidation triggered
  orderPrice?: number; // may differ from liquidation price
  estimatedValueUsd: number;
  timestamp: number; // milliseconds
  
  // Whale signal
  isWhaleLiquidation: boolean; // true if > $1M or > 10 BTC
  whaleTier?: "tier1" | "tier2" | "tier3"; // based on size
  cascadeRisk?: number; // 0.0-1.0: risk of triggering more liquidations
}

// ═══════════════════════════════════════════════════════════════
// Exchange Flow Metrics (Aggregate)
// ═══════════════════════════════════════════════════════════════

export interface CexFlowMetrics {
  exchange: "binance" | "bybit" | "okx" | "hyperliquid" | "kraken";
  timestamp: number;
  
  // 24h aggregates
  totalVolume24hUsd: number;
  totalLiquidations24hUsd: number;
  totalLiquidationCount24h: number;
  longLiquidations24hPercent: number;
  
  // Funding pressure
  avgFundingRate8h: number;
  fundingWeightedByOi: number; // weighted by open interest
  
  // Liquidity snapshot
  bidAskSpreadMedianBps: number;
  orderBookDepth1pct: number; // USD amount at top 1% of order book
  
  // Health
  isHealthy: boolean;
  statusMessage?: string;
}

// ═══════════════════════════════════════════════════════════════
// Aggregate CEX Market State
// ═══════════════════════════════════════════════════════════════

export interface CexMarketState {
  timestamp: number;
  exchanges: CexExchange[];
  pairs: CexPair[]; // all pairs across all exchanges
  fundingRates: CexFundingRate[];
  openInterest: CexOpenInterest[];
  liquidations: CexLiquidation[]; // last 24h
  flowMetrics: CexFlowMetrics[];
  
  // Composite signals
  globalFundingAvg: number;
  globalOiUsd: number;
  totalLiquidations24hUsd: number;
  whaleActivityScore: number; // 0-100
}
```

---

## 5. Architecture: Unified vs Per-Exchange

### Decision: **Unified Client with Adapter Pattern**

```
src/lib/cex/
├── client.ts                 # Main CexClient (facade)
├── types.ts                  # All shared types
├── adapters/
│   ├── index.ts             # Export all adapters
│   ├── binance.ts           # BinanceAdapter
│   ├── bybit.ts             # BybitAdapter
│   ├── okx.ts               # OkxAdapter
│   ├── hyperliquid.ts       # HyperliquidAdapter
│   └── kraken.ts            # KrakenAdapter
├── cache.ts                 # Shared caching layer
├── rate-limiter.ts          # Per-exchange rate limit handling
├── websocket/
│   ├── index.ts             # WebSocket manager
│   ├── stream-handler.ts    # Unified stream processing
│   └── reconnect.ts         # Auto-reconnect logic
└── __tests__/
    └── cex.test.ts
```

### Why Unified?

1. **Single point of entry** for callers: `CexClient.getPairs("BTCUSDT")` returns data from all exchanges
2. **Adapter pattern** allows each exchange logic to be isolated and testable
3. **Shared caching** across exchanges reduces redundant calls
4. **Rate limit management** centralized per exchange
5. **Easy to add/remove** exchanges without changing caller code

---

## 6. Implementation Architecture

### 6.1 Unified CexClient

```typescript
// src/lib/cex/client.ts

import { BinanceAdapter } from "./adapters/binance";
import { BybitAdapter } from "./adapters/bybit";
import { OkxAdapter } from "./adapters/okx";
import { HyperliquidAdapter } from "./adapters/hyperliquid";
import { KrakenAdapter } from "./adapters/kraken";
import { CexCache } from "./cache";
import { CexRateLimiter } from "./rate-limiter";

export class CexClient {
  private cache: CexCache;
  private rateLimiter: CexRateLimiter;
  private adapters: {
    binance: BinanceAdapter;
    bybit: BybitAdapter;
    okx: OkxAdapter;
    hyperliquid: HyperliquidAdapter;
    kraken: KrakenAdapter;
  };

  constructor() {
    this.cache = new CexCache();
    this.rateLimiter = new CexRateLimiter();
    this.adapters = {
      binance: new BinanceAdapter(this.cache, this.rateLimiter),
      bybit: new BybitAdapter(this.cache, this.rateLimiter),
      okx: new OkxAdapter(this.cache, this.rateLimiter),
      hyperliquid: new HyperliquidAdapter(this.cache, this.rateLimiter),
      kraken: new KrakenAdapter(this.cache, this.rateLimiter),
    };
  }

  // ─── Market Data ───────────────────────────────

  /** Get pair data from all exchanges, filter by symbol */
  async getPairs(symbol?: string): Promise<CexPair[]> {
    const cached = this.cache.getPairs(symbol);
    if (cached) return cached;

    const allPairs = await Promise.all([
      this.adapters.binance.getPairs(symbol),
      this.adapters.bybit.getPairs(symbol),
      this.adapters.okx.getPairs(symbol),
      this.adapters.hyperliquid.getPairs(symbol),
      this.adapters.kraken.getPairs(symbol),
    ]);

    const merged = allPairs.flat();
    this.cache.setPairs(merged);
    return merged;
  }

  /** Get funding rates for a symbol across all futures-enabled exchanges */
  async getFundingRates(symbol: string): Promise<CexFundingRate[]> {
    const cached = this.cache.getFundingRates(symbol);
    if (cached) return cached;

    const rates = await Promise.all([
      this.adapters.binance.getFundingRates(symbol),
      this.adapters.bybit.getFundingRates(symbol),
      this.adapters.okx.getFundingRates(symbol),
      this.adapters.hyperliquid.getFundingRates(symbol),
    ]);

    const merged = rates.flat();
    this.cache.setFundingRates(symbol, merged);
    return merged;
  }

  /** Get liquidations from the last N hours */
  async getLiquidations(options?: {
    hours?: number;
    exchanges?: string[];
    minUsd?: number;
  }): Promise<CexLiquidation[]> {
    const { hours = 24, exchanges, minUsd = 100000 } = options || {};
    
    let adaptersToQuery = Object.entries(this.adapters);
    if (exchanges) {
      adaptersToQuery = adaptersToQuery.filter(([key]) =>
        exchanges.includes(key)
      );
    }

    const liquidations = await Promise.all(
      adaptersToQuery.map(([, adapter]) =>
        adapter.getLiquidations(hours)
      )
    );

    return liquidations
      .flat()
      .filter((liq) => liq.estimatedValueUsd >= minUsd)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // ─── WebSocket ─────────────────────────────

  async subscribeToFundingRates(symbols: string[]): Promise<void> {
    // Delegate to WebSocket manager
  }

  async subscribeToLiquidations(): Promise<void> {
    // Subscribe to all liquidation streams
  }

  // ─── Health ────────────────────────────────

  async getExchangeStatus(): Promise<Record<string, CexExchange>> {
    return {
      binance: await this.adapters.binance.getExchangeStatus(),
      bybit: await this.adapters.bybit.getExchangeStatus(),
      okx: await this.adapters.okx.getExchangeStatus(),
      hyperliquid: await this.adapters.hyperliquid.getExchangeStatus(),
      kraken: await this.adapters.kraken.getExchangeStatus(),
    };
  }
}

export const cexClient = new CexClient();
```

### 6.2 Adapter Pattern (Example: Binance)

```typescript
// src/lib/cex/adapters/binance.ts

import { CexPair, CexFundingRate, CexLiquidation } from "../types";
import { CexCache } from "../cache";
import { CexRateLimiter } from "../rate-limiter";

const BINANCE_REST = "https://api.binance.com";
const BINANCE_FAPI = "https://fapi.binance.com";

export class BinanceAdapter {
  constructor(
    private cache: CexCache,
    private rateLimiter: CexRateLimiter
  ) {}

  async getPairs(symbol?: string): Promise<CexPair[]> {
    const cacheKey = `binance_pairs_${symbol || "all"}`;
    const cached = this.cache.get<CexPair[]>(cacheKey);
    if (cached) return cached;

    await this.rateLimiter.wait("binance", 40); // 40/min limit

    // Fetch from both /api/v3 (spot) and /fapi/v1 (futures)
    const [spotTickers, futuresTickers, exchangeInfo] = await Promise.all([
      this.fetchSpotTickers(symbol),
      this.fetchFuturesTickers(symbol),
      this.fetchExchangeInfo(),
    ]);

    const pairs = [
      ...this.normalizeSpotPairs(spotTickers, exchangeInfo),
      ...this.normalizeFuturesPairs(futuresTickers),
    ];

    this.cache.set(cacheKey, pairs, 60); // 60s cache
    return pairs;
  }

  async getFundingRates(symbol: string): Promise<CexFundingRate[]> {
    await this.rateLimiter.wait("binance", 200); // 200/min for futures

    const response = await fetch(
      `${BINANCE_FAPI}/fapi/v1/fundingRate?symbol=${symbol.toUpperCase()}`
    );
    if (!response.ok) throw new Error(`Binance funding rate error: ${response.status}`);

    const data = await response.json();
    return data.map((item: any) => ({
      id: `binance_${symbol}_${item.fundingTime}`,
      exchange: "binance",
      symbol,
      fundingRate: parseFloat(item.fundingRate),
      fundingTimestamp: item.fundingTime,
      timestamp: Date.now(),
      isPositive: parseFloat(item.fundingRate) > 0,
      magnitude: this.estimateMagnitude(parseFloat(item.fundingRate)),
    }));
  }

  async getLiquidations(hours: number): Promise<CexLiquidation[]> {
    // Binance doesn't expose liquidations via public API
    // Return empty array or fetch from liquidation aggregator
    return [];
  }

  private async fetchSpotTickers(symbol?: string): Promise<any[]> {
    const url = new URL(`${BINANCE_REST}/api/v3/ticker/24hr`);
    if (symbol) url.searchParams.set("symbol", symbol.toUpperCase());

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance spot tickers error`);
    return response.json();
  }

  private async fetchFuturesTickers(symbol?: string): Promise<any[]> {
    const url = new URL(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`);
    if (symbol) url.searchParams.set("symbol", symbol.toUpperCase());

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance futures tickers error`);
    return response.json();
  }

  private async fetchExchangeInfo(): Promise<any> {
    const response = await fetch(`${BINANCE_REST}/api/v3/exchangeInfo`);
    if (!response.ok) throw new Error(`Binance exchange info error`);
    return response.json();
  }

  private normalizeSpotPairs(tickers: any[], info: any): CexPair[] {
    // Implementation: normalize to CexPair type
    return [];
  }

  private normalizeFuturesPairs(tickers: any[]): CexPair[] {
    // Implementation: normalize to CexPair type
    return [];
  }

  private estimateMagnitude(rate: number): "extreme" | "high" | "normal" | "low" {
    const absRate = Math.abs(rate);
    if (absRate > 0.001) return "extreme";
    if (absRate > 0.0005) return "high";
    if (absRate > 0.0001) return "normal";
    return "low";
  }

  async getExchangeStatus(): Promise<any> {
    // Implementation
    return {};
  }
}
```

### 6.3 WebSocket Integration (Indexer)

```typescript
// indexer/integrations/cex-websocket.ts

import { WebSocket } from "ws";

interface StreamSubscription {
  exchange: string;
  symbol: string;
  channels: string[]; // "funding", "liquidations", "klines", etc.
}

export class CexWebSocketManager {
  private connections: Map<string, WebSocket> = new Map();
  private subscriptions: Map<string, StreamSubscription[]> = new Map();

  async subscribe(sub: StreamSubscription): Promise<void> {
    const { exchange, symbol, channels } = sub;

    switch (exchange) {
      case "bybit":
        return this.subscribeBybit(symbol, channels);
      case "okx":
        return this.subscribeOkx(symbol, channels);
      case "hyperliquid":
        return this.subscribeHyperliquid(symbol, channels);
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }

  private async subscribeBybit(symbol: string, channels: string[]): Promise<void> {
    const ws = this.getOrCreateConnection("bybit", "wss://stream.bybit.com/v5/public/linear");

    for (const channel of channels) {
      const topic = channel === "funding" ? "funding" : `${channel}.${symbol}`;
      ws.send(
        JSON.stringify({
          op: "subscribe",
          args: [topic],
        })
      );
    }
  }

  private async subscribeOkx(symbol: string, channels: string[]): Promise<void> {
    const ws = this.getOrCreateConnection("okx", "wss://ws.okx.com:8443/ws/v5/public");

    for (const channel of channels) {
      const instId = `${symbol.split("-")[0]}-${symbol.split("-")[1]}-SWAP`;
      ws.send(
        JSON.stringify({
          op: "subscribe",
          args: [
            {
              channel: channel === "funding" ? "funding-rate" : channel,
              instId,
            },
          ],
        })
      );
    }
  }

  private async subscribeHyperliquid(symbol: string, channels: string[]): Promise<void> {
    const ws = this.getOrCreateConnection("hyperliquid", "wss://api.hyperliquid.xyz/ws");

    for (const channel of channels) {
      ws.send(
        JSON.stringify({
          method: "subscribe",
          subscription: {
            type: channel,
            coin: symbol,
          },
        })
      );
    }
  }

  private getOrCreateConnection(exchange: string, url: string): WebSocket {
    if (this.connections.has(exchange)) {
      return this.connections.get(exchange)!;
    }

    const ws = new WebSocket(url);
    
    ws.on("message", (data) => {
      this.handleMessage(exchange, data.toString());
    });

    ws.on("error", (error) => {
      console.error(`${exchange} WebSocket error:`, error);
      // Implement exponential backoff reconnect
    });

    this.connections.set(exchange, ws);
    return ws;
  }

  private async handleMessage(exchange: string, data: string): Promise<void> {
    try {
      const message = JSON.parse(data);
      
      // Route to database or cache based on message type
      if (message.type === "liquidation" || message.channel === "liquidation-orders") {
        await this.handleLiquidation(exchange, message);
      } else if (message.type === "funding" || message.channel === "funding-rate") {
        await this.handleFundingRate(exchange, message);
      }
    } catch (error) {
      console.error(`${exchange} message parse error:`, error);
    }
  }

  private async handleLiquidation(exchange: string, message: any): Promise<void> {
    // Insert into database or cache
    console.log(`[${exchange}] Liquidation:`, message);
  }

  private async handleFundingRate(exchange: string, message: any): Promise<void> {
    // Insert into database or cache
    console.log(`[${exchange}] Funding rate:`, message);
  }
}
```

---

## 7. API Routes & Integration with Existing System

### 7.1 New API Route: `/api/v1/cex/...`

```
src/app/api/v1/cex/
├── route.ts                    # GET /cex - All exchanges status
├── pairs/
│   └── route.ts               # GET /cex/pairs?symbol=BTCUSDT
├── funding-rates/
│   └── route.ts               # GET /cex/funding-rates?symbol=BTCUSDT
├── liquidations/
│   └── route.ts               # GET /cex/liquidations?hours=24&min_usd=100000
├── open-interest/
│   └── route.ts               # GET /cex/open-interest?symbol=BTCUSDT
└── market-state/
    └── route.ts               # GET /cex/market-state
```

### 7.2 Example Route Implementation

```typescript
// src/app/api/v1/cex/pairs/route.ts

import { NextRequest } from "next/server";
import { cexClient } from "@/lib/cex/client";
import { apiSuccess, apiError } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get("symbol");
    const exchange = request.nextUrl.searchParams.get("exchange");

    let pairs = await cexClient.getPairs(symbol);

    if (exchange) {
      pairs = pairs.filter((p) => p.exchange === exchange);
    }

    return apiSuccess({
      data: pairs,
      count: pairs.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("GET /api/v1/cex/pairs error:", error);
    return apiError(error instanceof Error ? error.message : "Failed to fetch pairs");
  }
}
```

### 7.3 Integration with `data-freshness.ts`

Add to `src/lib/data-freshness.ts`:

```typescript
export type DataSourceId =
  | 'defillama'
  | 'jupiter'
  | // ... existing sources ...
  | 'cex-binance'      // ← NEW
  | 'cex-bybit'        // ← NEW
  | 'cex-okx'          // ← NEW
  | 'cex-hyperliquid'  // ← NEW
  | 'cex-kraken';      // ← NEW

const SOURCE_METADATA: Record<DataSourceId, SourceMetadata> = {
  // ... existing ...
  'cex-binance': {
    name: 'Binance CEX',
    category: 'CEX',
    requiredForCore: true,
    enabled: true,
  },
  'cex-bybit': {
    name: 'Bybit CEX',
    category: 'CEX',
    requiredForCore: true,
    enabled: true,
  },
  'cex-okx': {
    name: 'OKX CEX',
    category: 'CEX',
    requiredForCore: false,
    enabled: true,
  },
  'cex-hyperliquid': {
    name: 'Hyperliquid',
    category: 'CEX',
    requiredForCore: false,
    enabled: true,
  },
  'cex-kraken': {
    name: 'Kraken CEX',
    category: 'CEX',
    requiredForCore: false,
    enabled: true,
  },
};
```

---

## 8. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Create `src/lib/cex/types.ts` with all TypeScript interfaces
- [ ] Create `src/lib/cex/cache.ts` with TTL-based caching
- [ ] Create `src/lib/cex/rate-limiter.ts` for per-exchange rate limiting
- [ ] Create `CexClient` class in `src/lib/cex/client.ts`
- [ ] **Add to `data-freshness.ts`** with 5 new sources

### Phase 2: Binance Adapter (Week 2)
- [ ] Implement `BinanceAdapter`
  - [x] `getPairs()` - spot + futures tickers
  - [x] `getFundingRates()` - current + historical
  - [x] `getOpenInterest()` - OI data
  - [ ] `getLiquidations()` - return empty (not available)
- [ ] Create `/api/v1/cex/pairs` route
- [ ] Create `/api/v1/cex/funding-rates` route
- [ ] Unit tests for Binance adapter

### Phase 3: Bybit Adapter (Week 3)
- [ ] Implement `BybitAdapter`
  - [x] `getPairs()` - spot + linear perpetuals
  - [x] `getFundingRates()` - real-time + history
  - [x] `getOpenInterest()` - OI data
  - [x] `getLiquidations()` - ⭐ KEY FEATURE
- [ ] WebSocket integration for liquidations (indexer)
- [ ] Create `/api/v1/cex/liquidations` route
- [ ] Unit tests

### Phase 4: OKX Adapter (Week 3-4)
- [ ] Implement `OkxAdapter`
  - [x] `getPairs()` - spot + swap
  - [x] `getFundingRates()` - current + history
  - [x] `getOpenInterest()` - OI data
  - [x] `getLiquidations()` - from liquidation-orders endpoint
- [ ] WebSocket integration
- [ ] Unit tests

### Phase 5: Hyperliquid & Kraken (Week 4-5)
- [ ] Implement `HyperliquidAdapter`
  - [x] HTTP POST-based API (no auth needed)
  - [x] Liquidations via WebSocket
- [ ] Implement `KrakenAdapter` (spot data only)
- [ ] WebSocket manager for all exchanges
- [ ] Unit tests

### Phase 6: Advanced Features (Week 5-6)
- [ ] WebSocket connections in indexer for real-time liquidations & funding
- [ ] Whale liquidation detection (size-based tiering)
- [ ] Cascade risk calculation
- [ ] `/api/v1/cex/market-state` aggregate endpoint
- [ ] Dashboard widgets using CEX data

### Phase 7: Polish & Deploy (Week 6)
- [ ] E2E tests
- [ ] Rate limit stress testing
- [ ] Documentation
- [ ] Metrics/monitoring (Prometheus)
- [ ] Deploy to production

---

## 9. Rate Limiting Strategy

### Per-Exchange Limits

| Exchange | Limit | Strategy | Burst Handling |
|----------|-------|----------|-----------------|
| Binance | 1200 requests/min | Token bucket | Queue when exhausted |
| Bybit | 1000 requests/min | Token bucket | 10% buffer |
| OKX | 30 requests/sec | Token bucket | 5% buffer |
| Hyperliquid | Unlimited | No limiting | No action |
| Kraken | 15 requests/sec | Leaky bucket | Queue + exponential backoff |

```typescript
// src/lib/cex/rate-limiter.ts

export class CexRateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();

  private getBucket(exchange: string): TokenBucket {
    if (!this.buckets.has(exchange)) {
      const limits = {
        binance: { rate: 1200 / 60, capacity: 120 }, // 20 req/sec, burst 120
        bybit: { rate: 1000 / 60, capacity: 100 },
        okx: { rate: 30, capacity: 300 },
        hyperliquid: { rate: Infinity, capacity: Infinity },
        kraken: { rate: 15, capacity: 150 },
      };
      const config = limits[exchange as keyof typeof limits];
      this.buckets.set(exchange, new TokenBucket(config.rate, config.capacity));
    }
    return this.buckets.get(exchange)!;
  }

  async wait(exchange: string, tokens: number = 1): Promise<void> {
    const bucket = this.getBucket(exchange);
    const delay = await bucket.acquire(tokens);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number = Date.now();

  constructor(private rate: number, private capacity: number) {
    this.tokens = capacity;
  }

  async acquire(count: number): Promise<number> {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return 0; // No wait needed
    }

    // Calculate how long to wait
    const deficit = count - this.tokens;
    const waitMs = (deficit / this.rate) * 1000;
    return Math.ceil(waitMs);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.rate
    );
    this.lastRefill = now;
  }
}
```

---

## 10. Caching Strategy

```typescript
// src/lib/cex/cache.ts

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

export class CexCache {
  private store: Map<string, CacheEntry<any>> = new Map();
  private readonly CLEANUP_INTERVAL = 60000; // 1 minute

  constructor() {
    // Periodic cleanup of expired entries
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.store.delete(key);
      return null;
    }

    return entry.data as T;
  }

  getPairs(symbol?: string): CexPair[] | null {
    const key = symbol ? `pairs_${symbol}` : "pairs_all";
    return this.get(key);
  }

  setPairs(pairs: CexPair[], symbol?: string): void {
    const key = symbol ? `pairs_${symbol}` : "pairs_all";
    this.set(key, pairs, 60); // 60s TTL
  }

  getFundingRates(symbol: string): CexFundingRate[] | null {
    return this.get(`funding_${symbol}`);
  }

  setFundingRates(symbol: string, rates: CexFundingRate[]): void {
    this.set(`funding_${symbol}`, rates, 30); // 30s TTL (volatile)
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.store.delete(key);
      }
    }
  }
}
```

### Cache TTL Recommendations

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Spot prices | 10-30s | Fast-moving, whale arbitrage signal |
| Funding rates | 30-60s | Updated every 8h, but clients check frequently |
| Open interest | 60-120s | Slower moving, compute-heavy |
| Liquidations | 0s (real-time) | WebSocket stream, never cache |
| Exchange info | 3600s | Static, fetch once per hour |

---

## 11. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client / Dashboard                        │
│                     (Next.js Frontend)                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Routes (/api/v1/cex/)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  /cex/pairs     /cex/funding-rates    /cex/liquidations │   │
│  └──────────────────┬──────────────────────────────────────┘   │
└───────────────────────┼────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              CexClient (src/lib/cex/client.ts)                  │
│                    Unified Facade                               │
└────────────────┬──────────────────────────┬────────────────────┘
                 │                          │
        ┌────────▼──────────┐       ┌──────▼──────────┐
        │    REST Cache     │       │  Rate Limiter   │
        │ (CexCache class)  │       │ (TokenBucket)   │
        └──────────────────┘       └─────────────────┘
                 │
    ┌────────────┼────────────┬──────────────┬─────────────┐
    │            │            │              │             │
    ▼            ▼            ▼              ▼             ▼
┌────────┐  ┌────────┐  ┌───────┐  ┌──────────┐  ┌────────┐
│Binance │  │ Bybit  │  │  OKX  │  │Hyper     │  │Kraken  │
│Adapter │  │Adapter │  │Adapter│  │liquid    │  │Adapter │
│        │  │        │  │       │  │Adapter   │  │        │
└────┬───┘  └───┬────┘  └──┬────┘  └────┬─────┘  └────────┘
     │          │          │           │
     │ REST     │ REST     │ HTTP      │ WebSocket
     │ /api/    │ /api/    │ POST      │
     │          │          │           │
     ▼          ▼          ▼           ▼
  Binance     Bybit       OKX      Hyperliquid
  Public API  Public API  Public API  Public API

┌─────────────────────────────────────────────────────────────────┐
│                 Indexer (Real-time Only)                        │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  WebSocket Manager (CexWebSocketManager)               │   │
│  │                                                         │   │
│  │  • Bybit  liquidations stream                          │   │
│  │  • OKX    liquidation-orders stream                    │   │
│  │  • Hyperliquid liquidations stream                     │   │
│  │  • All    funding rate streams                         │   │
│  └────────────────┬────────────────────────────────────┬─┘   │
└───────────────────┼────────────────────────────────────┼──────┘
                    │                                    │
            ┌───────▼────────┐              ┌───────────▼────┐
            │ Database Write │              │ Redis Cache    │
            │ (Liquidations) │              │ (Real-time OI) │
            └────────────────┘              └────────────────┘
```

---

## 12. Error Handling & Resilience

### Error Classes

```typescript
// src/lib/cex/errors.ts

export class CexError extends Error {
  constructor(
    public exchange: string,
    public code: string,
    message: string,
    public statusCode?: number
  ) {
    super(`[${exchange}] ${code}: ${message}`);
  }
}

export class RateLimitError extends CexError {
  constructor(exchange: string, public retryAfterMs: number) {
    super(exchange, "RATE_LIMIT", `Rate limited, retry after ${retryAfterMs}ms`);
  }
}

export class ExchangeOfflineError extends CexError {
  constructor(exchange: string) {
    super(exchange, "OFFLINE", "Exchange is offline or unreachable");
  }
}

export class DataValidationError extends CexError {
  constructor(exchange: string, field: string) {
    super(exchange, "VALIDATION", `Invalid data in field: ${field}`);
  }
}
```

### Circuit Breaker Pattern

```typescript
// src/lib/cex/circuit-breaker.ts

export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

export class CexCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    private threshold = 5, // failures to open
    private resetTimeout = 60000 // ms
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new Error("Circuit breaker is OPEN");
      }
    }

    try {
      const result = await fn();

      if (this.state === CircuitState.HALF_OPEN) {
        this.successCount++;
        if (this.successCount >= 2) {
          this.state = CircuitState.CLOSED;
          this.failureCount = 0;
        }
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.threshold) {
        this.state = CircuitState.OPEN;
      }

      throw error;
    }
  }
}
```

---

## 13. Monitoring & Observability

### Metrics to Track

```typescript
// src/lib/cex/metrics.ts

export interface CexMetrics {
  exchange: string;
  apiCallCount: number;
  apiCallErrorCount: number;
  apiCallLatencyMs: number[];
  cacheHitRate: number;
  rateLimitHits: number;
  websocketConnectionUptime: number;
  lastSuccessfulUpdate: number;
}

export class CexMetricsCollector {
  private metrics: Map<string, CexMetrics> = new Map();

  recordApiCall(
    exchange: string,
    success: boolean,
    latencyMs: number
  ): void {
    const m = this.metrics.get(exchange) || this.initMetrics(exchange);
    m.apiCallCount++;
    if (!success) m.apiCallErrorCount++;
    m.apiCallLatencyMs.push(latencyMs);
    if (success) m.lastSuccessfulUpdate = Date.now();
    this.metrics.set(exchange, m);
  }

  recordCacheHit(exchange: string, hit: boolean): void {
    const m = this.metrics.get(exchange) || this.initMetrics(exchange);
    // Update hit rate calculation
    this.metrics.set(exchange, m);
  }

  private initMetrics(exchange: string): CexMetrics {
    return {
      exchange,
      apiCallCount: 0,
      apiCallErrorCount: 0,
      apiCallLatencyMs: [],
      cacheHitRate: 0,
      rateLimitHits: 0,
      websocketConnectionUptime: 0,
      lastSuccessfulUpdate: 0,
    };
  }

  getMetrics(exchange?: string): CexMetrics[] {
    if (exchange) {
      return [this.metrics.get(exchange) || this.initMetrics(exchange)];
    }
    return Array.from(this.metrics.values());
  }
}
```

---

## 14. Testing Strategy

### Unit Tests (Per Adapter)

```typescript
// src/lib/cex/__tests__/binance.test.ts

import { BinanceAdapter } from "../adapters/binance";
import { CexCache } from "../cache";
import { CexRateLimiter } from "../rate-limiter";

describe("BinanceAdapter", () => {
  let adapter: BinanceAdapter;
  let cache: CexCache;
  let limiter: CexRateLimiter;

  beforeEach(() => {
    cache = new CexCache();
    limiter = new CexRateLimiter();
    adapter = new BinanceAdapter(cache, limiter);
  });

  describe("getPairs", () => {
    it("should_fetch_btcusdt_pair_and_normalize", async () => {
      // Mock fetch
      const pairs = await adapter.getPairs("BTCUSDT");

      expect(pairs).toHaveLength(2); // spot + futures
      expect(pairs[0].baseSymbol).toBe("BTC");
      expect(pairs[0].quoteSymbol).toBe("USDT");
    });

    it("should_cache_pairs_and_avoid_refetch", async () => {
      const pairs1 = await adapter.getPairs("BTCUSDT");
      const pairs2 = await adapter.getPairs("BTCUSDT");

      expect(pairs1).toEqual(pairs2);
      // Verify cache was hit (mock only one fetch)
    });
  });

  describe("getFundingRates", () => {
    it("should_return_funding_rate_with_magnitude", async () => {
      const rates = await adapter.getFundingRates("BTCUSDT");

      expect(rates).toBeDefined();
      expect(rates[0].magnitude).toMatch(/extreme|high|normal|low/);
      expect(rates[0].isPositive).toBeDefined();
    });
  });

  describe("getLiquidations", () => {
    it("should_return_empty_array_for_binance", async () => {
      const liq = await adapter.getLiquidations(24);
      expect(liq).toEqual([]);
    });
  });
});
```

### Integration Tests

```typescript
// src/lib/cex/__tests__/cex-client.test.ts

describe("CexClient", () => {
  let client: CexClient;

  beforeEach(() => {
    client = new CexClient();
  });

  it("should_return_pairs_from_all_exchanges", async () => {
    const pairs = await client.getPairs("BTCUSDT");

    expect(pairs.length).toBeGreaterThan(0);
    const exchanges = new Set(pairs.map((p) => p.exchange));
    expect(exchanges.has("binance")).toBe(true);
    expect(exchanges.has("bybit")).toBe(true);
  });

  it("should_get_liquidations_over_minimum_size", async () => {
    const liq = await client.getLiquidations({
      hours: 1,
      minUsd: 1000000,
    });

    if (liq.length > 0) {
      expect(liq[0].estimatedValueUsd).toBeGreaterThanOrEqual(1000000);
      expect(liq[0].isWhaleLiquidation).toBe(true);
    }
  });
});
```

---

## 15. Edge Cases & Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Exchange API downtime | Data gaps | Fallback to cached data, health checks |
| Data inconsistency (same pair, different prices) | Arbitrage signals false positive | Normalize to median price, confidence score |
| Rate limits exceeded | Request queuing | Token bucket, exponential backoff |
| Stale liquidation data | Missed whale activity | Real-time WebSocket, deduplicate by timestamp+symbol |
| WebSocket disconnection | Lost real-time stream | Auto-reconnect, circuit breaker |
| Funding rate edge cases (negative rate flip) | Wrong signal interpretation | Timestamp-based deduplication, direction tracking |
| Precision loss (very small numbers) | Rounding errors | Use Decimal/BigNum for rates, track basis points |
| Exchange pair name inconsistency | Failed symbol matching | Normalize: BTCUSDT, BTC-USDT → internal "BTC/USDT" |

---

## 16. Go-Live Checklist

- [ ] All adapters deployed and tested
- [ ] WebSocket streams stable (>99.5% uptime in staging)
- [ ] Rate limits never exceeded in load test
- [ ] Cache TTLs optimized (measure hit rates)
- [ ] Error handling: no silent failures
- [ ] Metrics/observability dashboard live
- [ ] On-call rotation for exchange API changes
- [ ] Documentation for adding new exchanges
- [ ] Client library examples in README
- [ ] Data freshness integrated with dashboard

---

## 17. Cost Analysis

### API Call Volume (Estimated)

```
Binance pairs (1 req):        1 req / 60s
Bybit pairs (1 req):          1 req / 60s
OKX pairs (1 req):            1 req / 60s
Hyperliquid pairs (HTTP POST): 1 req / 60s
Kraken pairs (1 req):         1 req / 60s

Funding rates (per symbol): 5 symbols × 5 exchanges = 25 req / 30s
Open interest (per symbol): 5 symbols × 4 exchanges = 20 req / 60s
Liquidations (per exchange): 5 exchanges × 1 req / 5s = 1 req / sec

TOTAL: ~100-150 req/minute = 144,000-216,000 req/day

Cost: $0 (all free APIs) ✅
```

---

## 18. Summary

**The NEXUS CEX architecture is designed for:**

1. ✅ **Zero API keys** — all data from public endpoints
2. ✅ **Real-time signals** — WebSocket liquidations & funding rates <5s latency
3. ✅ **Scalability** — unified client, per-exchange adapters, rate limit management
4. ✅ **Whale signals** — liquidations, funding rates, OI spikes, spot arb opportunities
5. ✅ **Reliability** — circuit breakers, caching, fallbacks, health checks
6. ✅ **Extensibility** — easy to add new exchanges or data types

**Signal Quality Ranking:**
1. **Liquidations** (Bybit, OKX, Hyperliquid) — whale activity indicator
2. **Funding Rates** (All) — market sentiment, long/short pressure
3. **Open Interest Spikes** (All) — capital entering markets
4. **Spot Price Arbitrage** (All) — microstructure inefficiencies

**Next Steps:** Start Phase 1 (types + cache + rate limiter) → Binance adapter → API routes → testing → Bybit (liquidations) → production.

