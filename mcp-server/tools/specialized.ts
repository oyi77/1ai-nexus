// NEXUS MCP tools -- specialized.

import type { McpTool } from '../types'

export const TOOLS_SPECIALIZED: McpTool[] = [
  // ── DefiLlama ──────────────────────────────────────────────
  {
    name: 'nexus_get_defillama',
    description: 'Direct DeFiLlama module access (protocols, chains, stablecoins)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['protocols', 'chains', 'stablecoins', 'fees', 'yields', 'prices'] },
      },
    },
  },

  // ── Token Terminal ──────────────────────────────────────────
  {
    name: 'nexus_get_token_terminal',
    description: 'Get protocol fundamentals from Token Terminal (revenue, fees, P/F ratios, active users, devs)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['projects', 'metrics', 'project', 'top'] },
        project: { type: 'string', description: 'Project slug for single project query' },
        limit: { type: 'number', description: 'Number of results for top projects' },
      },
    },
  },

  // ── Arkham Intelligence ─────────────────────────────────────
  {
    name: 'nexus_get_arkham_entity',
    description: 'Get entity label and wallet profile from Arkham Intelligence',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string', default: 'ethereum' },
      },
      required: ['address'],
    },
  },
  {
    name: 'nexus_get_arkham_portfolio',
    description: 'Get entity portfolio from Arkham Intelligence',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name from Arkham' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'nexus_search_arkham_entities',
    description: 'Search Arkham entities by name',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },

  // ── The Graph Subgraphs ─────────────────────────────────────
  {
    name: 'nexus_query_subgraph',
    description: 'Query a The Graph subgraph with custom GraphQL',
    inputSchema: {
      type: 'object',
      properties: {
        subgraph: { type: 'string', description: 'Subgraph name (e.g., uniswapV3Ethereum, aaveV3Ethereum)' },
        query: { type: 'string', description: 'GraphQL query string' },
        variables: { type: 'object', description: 'GraphQL variables' },
      },
      required: ['subgraph', 'query'],
    },
  },
  {
    name: 'nexus_get_uniswap_pools',
    description: 'Get Uniswap V3 pools with liquidity, volume, fees',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', enum: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'], default: 'ethereum' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'nexus_get_aave_reserves',
    description: 'Get Aave V3 reserves with rates and utilization',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', enum: ['ethereum', 'arbitrum', 'base'], default: 'ethereum' },
        limit: { type: 'number', default: 30 },
      },
    },
  },
  {
    name: 'nexus_get_gmx_markets',
    description: 'Get GMX V2 perpetual markets data',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', enum: ['ethereum', 'arbitrum'], default: 'arbitrum' },
      },
    },
  },
  {
    name: 'nexus_get_lido_data',
    description: 'Get Lido staking data (stETH supply, APR, validators)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_curve_pools',
    description: 'Get Curve pools with volume, fees, APY',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'nexus_get_top_defi_metrics',
    description: 'Get aggregated top DeFi protocol metrics across major protocols',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Sentiment (X API + LunarCrush) ──────────────────────────
  {
    name: 'nexus_get_sentiment_x',
    description: 'Get X/Twitter sentiment for crypto assets',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'Asset symbol (e.g., BTC, ETH, SOL)' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'nexus_get_sentiment_lunarcrush',
    description: 'Get LunarCrush Galaxy Scores and social metrics',
    inputSchema: {
      type: 'object',
      properties: {
        assets: { type: 'string', description: 'Comma-separated asset symbols' },
      },
    },
  },
  {
    name: 'nexus_get_aggregated_sentiment',
    description: 'Get combined sentiment score from X + LunarCrush',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'Asset symbol' },
      },
      required: ['asset'],
    },
  },

  // ── Macro (FRED + CoinMetrics) ──────────────────────────────
  {
    name: 'nexus_get_fred_macro',
    description: 'Get FRED macroeconomic indicators',
    inputSchema: {
      type: 'object',
      properties: {
        series: { type: 'string', description: 'FRED series ID (e.g., FEDFUNDS, CPIAUCSL, T10Y2Y, VIXCLS)' },
      },
    },
  },
  {
    name: 'nexus_get_fred_all',
    description: 'Get all key FRED macro indicators at once',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_coinmetrics',
    description: 'Get CoinMetrics on-chain macro data',
    inputSchema: {
      type: 'object',
      properties: {
        assets: { type: 'string', description: 'Comma-separated assets (btc,eth,sol,arb,op)' },
        metrics: { type: 'string', description: 'Comma-separated metrics (PriceUSD,MVRVRatio,NUPL,SOPR,HashRate,AdrActCnt,FeeTotUSD,NetFlowExUSD)' },
      },
    },
  },
  {
    name: 'nexus_get_macro_regime',
    description: 'Get current macro regime classification for position sizing',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_cycle_indicators',
    description: 'Get BTC/ETH cycle indicators (MVRV, NUPL, SOPR zones)',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', enum: ['BTC', 'ETH'], default: 'BTC' },
      },
    },
  },

  // ── DexScreener ────────────────────────────────────────────
  {
    name: 'nexus_get_dex_pools',
    description: 'Get trending DEX pools from GeckoTerminal',
    inputSchema: {
      type: 'object',
      properties: {
        network: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
]
