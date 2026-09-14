// NEXUS MCP tools -- newsMacro.

import type { McpTool } from '../types'

export const TOOLS_NEWSMACRO: McpTool[] = [
  // ── News & Sentiment ───────────────────────────────────────
  {
    name: 'nexus_get_news',
    description: 'Get aggregated news from RSS feeds',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_feeds',
    description: 'Get raw RSS feed articles',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_news_intel',
    description: 'Get GDELT news intelligence data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_sentiment',
    description: 'Get news sentiment scoring with per-asset breakdown',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_vimero',
    description: 'Get Vimero feed data',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Macro & TradFi ─────────────────────────────────────────
  {
    name: 'nexus_get_macro',
    description: 'Get macro economic indicators (Fed Funds Rate, 10Y Treasury, CPI)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_macro_indicators',
    description: 'Get FRED economic data by series ID',
    inputSchema: {
      type: 'object',
      properties: {
        series: { type: 'string', description: 'FRED series ID, e.g. FEDFUNDS, CPIAUCSL' },
      },
    },
  },
  {
    name: 'nexus_get_tradfi',
    description: 'Get traditional finance data (Kimchi premium, basis spreads)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_sectors',
    description: 'Get sector/equity data (IDX, IHSG, BBCA, BBRI)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_forex',
    description: 'Get forex exchange rates (requires API key)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_commodities',
    description: 'Get commodity prices (gold, silver, oil — requires API key)',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Alternative Data ───────────────────────────────────────
  {
    name: 'nexus_get_alt_data',
    description: 'Get alternative data (USGS earthquakes, NASA EONET, weather, flights, FEMA)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_weather_signals',
    description: 'Get weather anomaly signals for markets',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_gaps',
    description: 'Get SEC filings and FRED data gaps',
    inputSchema: { type: 'object', properties: {} },
  },
]
