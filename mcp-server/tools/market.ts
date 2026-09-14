// NEXUS MCP tools -- market.

import type { McpTool } from '../types'

export const TOOLS_MARKET: McpTool[] = [
  // ── Market Data ────────────────────────────────────────────
  {
    name: 'nexus_get_market_prices',
    description: 'Get live prices for BTC, ETH, SOL, forex, commodities from multiple exchanges',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_market_flow',
    description: 'Get exchange buy/sell volume flow (Binance, Bybit, OKX)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_market_sentiment',
    description: 'Get Fear & Greed Index with classification and history',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_ohlcv',
    description: 'Get OHLCV candles with optional technical indicators (SMA, EMA, RSI, MACD, Bollinger)',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'e.g. BTC, ETH' },
        interval: { type: 'string', enum: ['1m', '5m', '15m', '1h', '4h', '1d'] },
        limit: { type: 'number' },
        indicators: { type: 'string', description: 'Comma-separated: sma20, ema20, rsi14, macd, bb' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'nexus_get_history',
    description: 'Get historical price data for a symbol',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        interval: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_trending',
    description: 'Get trending tokens on GeckoTerminal',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
]
