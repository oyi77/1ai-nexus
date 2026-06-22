// ─────────────────────────────────────────────────────────────
// NEXUS MCP Server
// Port 4402 · Transport: HTTP + SSE
// Exposes ALL NEXUS API routes as MCP tools
// ─────────────────────────────────────────────────────────────

import http from 'node:http'

const PORT = Number(process.env.MCP_PORT ?? 4402)
const NEXUS_API = process.env.NEXUS_API_URL ?? 'http://localhost:4400'

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const TOOLS: McpTool[] = [
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

  // ── Derivatives ────────────────────────────────────────────
  {
    name: 'nexus_get_derivatives',
    description: 'Get derivatives data (open interest, funding rates, liquidations)',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        action: { type: 'string', enum: ['open-interest', 'funding'] },
      },
    },
  },
  {
    name: 'nexus_get_hyperliquid',
    description: 'Get Hyperliquid perpetual market data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_liquidations',
    description: 'Get recent liquidation events across exchanges',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── On-Chain Intelligence ──────────────────────────────────
  {
    name: 'nexus_get_whale_cluster',
    description: 'Get whale cluster data for major exchanges (Binance, Coinbase, Kraken, OKX)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_exchange_flow',
    description: 'Get exchange flow intelligence (whale deposits/withdrawals)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_mempool',
    description: 'Get Bitcoin mempool stats, congestion, and fee levels',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['stats', 'whale', 'all', 'blocks', 'hashrate'] },
      },
    },
  },
  {
    name: 'nexus_get_insider',
    description: 'Get insider/suspicious wallet detection alerts',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_gas',
    description: 'Get gas prices across chains (BTC, ETH, L2s, SOL)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_stablecoin_flow',
    description: 'Get stablecoin (USDT, USDC, DAI) flow data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_stablecoins',
    description: 'Get stablecoin peg status and market data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_rugcheck',
    description: 'Get rug-pull risk scores for tokens',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_macro_onchain',
    description: 'Get BTC on-chain macro metrics (MVRV, SOPR, NVT)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_correlations',
    description: 'Get cross-asset correlation data',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Smart Money ────────────────────────────────────────────
  {
    name: 'nexus_get_smart_money',
    description: 'Get smart money wallets ranked by score',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_smart_money_flow',
    description: 'Get smart money flow by entity category (CEX, VC, whale, DeFi)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_trace_wallet',
    description: 'Get wallet profile with entity label, tx history, and token transfers',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string' },
      },
      required: ['address'],
    },
  },
  {
    name: 'nexus_get_entity',
    description: 'Get entity label and wallet profile for an address',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string' },
      },
      required: ['address'],
    },
  },
  {
    name: 'nexus_get_entities',
    description: 'Get all labeled entities (exchanges, VCs, whales, protocols)',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_flows',
    description: 'Get capital flows between entities',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_copy_trade',
    description: 'Get copy-trading signals from smart money activity',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_pnl',
    description: 'Get PnL leaderboard or wallet-specific PnL',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string' },
        leaderboard: { type: 'string', enum: ['true', 'false'] },
        limit: { type: 'number' },
      },
    },
  },

  // ── Tokens ─────────────────────────────────────────────────
  {
    name: 'nexus_get_tokens',
    description: 'Get token list with prices, market cap, volume',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        chain: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_token_discover',
    description: 'Discover new tokens with rug scoring and smart money analysis',
    inputSchema: {
      type: 'object',
      properties: {
        sort: { type: 'string', enum: ['trending', 'volume', 'new', 'liquidity'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_exchanges',
    description: 'Get exchange list and data',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── DeFi ───────────────────────────────────────────────────
  {
    name: 'nexus_get_defi_tvl',
    description: 'Get DeFi protocol TVL rankings from DeFiLlama',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_defi_yields',
    description: 'Get DeFi yield pools sorted by APY',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        stablecoin: { type: 'string', enum: ['true', 'false'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_defi_overview',
    description: 'Get comprehensive DeFi overview (chains, DEX volumes, stablecoins, fees, yields)',
    inputSchema: { type: 'object', properties: {} },
  },

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

  // ── AI & Signals ───────────────────────────────────────────
  {
    name: 'nexus_get_signals',
    description: 'Get correlated cross-source intelligence signals',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_signal_confidence',
    description: 'Get signal confidence scores',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_edge_report',
    description: 'Get daily edge report with actionable signals',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_alpha_feed',
    description: 'Get alpha signals from edge report + news',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_chat',
    description: 'Send a message to the NEXUS AI assistant',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        agent: { type: 'string', description: 'Agent: whale, macro, rug, narrative, portfolio' },
      },
      required: ['message'],
    },
  },

  // ── Predictions ────────────────────────────────────────────
  {
    name: 'nexus_get_prediction_markets',
    description: 'Get Polymarket/Manifold prediction market data',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },

  // ── Alerts ─────────────────────────────────────────────────
  {
    name: 'nexus_get_alerts',
    description: 'Get active alerts (requires API key)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_alert_templates',
    description: 'Get available alert templates',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── System ─────────────────────────────────────────────────
  {
    name: 'nexus_get_status',
    description: 'Get system status and service health',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_data_sources',
    description: 'Get health status of all data sources',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_module_status',
    description: 'Get status of all 58+ data modules',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_telegram',
    description: 'Get Telegram bot status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_usage',
    description: 'Get API usage statistics',
    inputSchema: { type: 'object', properties: {} },
  },

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

// ─── API Caller ──────────────────────────────────────────────

async function callNexusApi(path: string): Promise<unknown> {
  const res = await fetch(`${NEXUS_API}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`NEXUS API ${res.status}: ${path}`)
  return res.json() as Promise<unknown>
}

async function postNexusApi(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${NEXUS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`NEXUS API ${res.status}: ${path}`)
  return res.json() as Promise<unknown>
}

// ─── Tool Router ─────────────────────────────────────────────

function qs(args: Record<string, unknown>, keys: string[]): string {
  const params = new URLSearchParams()
  for (const k of keys) {
    if (args[k] !== undefined && args[k] !== null) params.set(k, String(args[k]))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    // ── Market ─────────────────────────────────────────────
    case 'nexus_get_market_prices':
      return callNexusApi('/api/v1/market/prices')
    case 'nexus_get_market_flow':
      return callNexusApi('/api/v1/market/flow')
    case 'nexus_get_market_sentiment':
      return callNexusApi('/api/v1/market/sentiment')
    case 'nexus_get_ohlcv':
      return callNexusApi(`/api/v1/ohlcv${qs(args, ['symbol', 'interval', 'limit', 'indicators'])}`)
    case 'nexus_get_history':
      return callNexusApi(`/api/v1/history${qs(args, ['symbol', 'interval', 'limit'])}`)
    case 'nexus_get_trending':
      return callNexusApi(`/api/v1/trending${qs(args, ['limit'])}`)

    // ── Derivatives ────────────────────────────────────────
    case 'nexus_get_derivatives':
      return callNexusApi(`/api/v1/derivatives${qs(args, ['symbol', 'action'])}`)
    case 'nexus_get_hyperliquid':
      return callNexusApi('/api/v1/hyperliquid')
    case 'nexus_get_liquidations':
      return callNexusApi('/api/v1/liquidations')

    // ── On-Chain ───────────────────────────────────────────
    case 'nexus_get_whale_cluster':
      return callNexusApi('/api/v1/whale-cluster')
    case 'nexus_get_exchange_flow':
      return callNexusApi('/api/v1/exchange-flow')
    case 'nexus_get_mempool':
      return callNexusApi(`/api/v1/mempool${qs(args, ['action'])}`)
    case 'nexus_get_insider':
      return callNexusApi('/api/v1/insider')
    case 'nexus_get_gas':
      return callNexusApi('/api/v1/gas')
    case 'nexus_get_stablecoin_flow':
      return callNexusApi('/api/v1/stablecoin-flow')
    case 'nexus_get_stablecoins':
      return callNexusApi('/api/v1/stablecoins')
    case 'nexus_get_rugcheck':
      return callNexusApi('/api/v1/rugcheck')
    case 'nexus_get_macro_onchain':
      return callNexusApi('/api/v1/macro-onchain')
    case 'nexus_get_correlations':
      return callNexusApi('/api/v1/correlations')

    // ── Smart Money ────────────────────────────────────────
    case 'nexus_get_smart_money':
      return callNexusApi(`/api/v1/smart-money${qs(args, ['limit'])}`)
    case 'nexus_get_smart_money_flow':
      return callNexusApi('/api/v1/smart-money/flow')
    case 'nexus_trace_wallet':
      return callNexusApi(`/api/v1/smart-money/wallet${qs(args, ['address', 'chain'])}`)
    case 'nexus_get_entity':
      return callNexusApi(`/api/v1/smart-money/wallet${qs(args, ['address', 'chain'])}`)
    case 'nexus_get_entities':
      return callNexusApi(`/api/v1/entities${qs(args, ['limit'])}`)
    case 'nexus_get_flows':
      return callNexusApi('/api/v1/flows')
    case 'nexus_get_copy_trade':
      return callNexusApi('/api/v1/copy-trade')
    case 'nexus_get_pnl':
      return callNexusApi(`/api/v1/pnl${qs(args, ['address', 'chain', 'leaderboard', 'limit'])}`)

    // ── Tokens ─────────────────────────────────────────────
    case 'nexus_get_tokens':
      return callNexusApi(`/api/v1/tokens${qs(args, ['search', 'chain', 'limit'])}`)
    case 'nexus_get_token_discover':
      return callNexusApi(`/api/v1/tokens/discover${qs(args, ['sort', 'limit'])}`)
    case 'nexus_get_exchanges':
      return callNexusApi('/api/v1/exchanges')

    // ── DeFi ───────────────────────────────────────────────
    case 'nexus_get_defi_tvl':
      return callNexusApi(`/api/v1/defi/tvl${qs(args, ['chain', 'limit'])}`)
    case 'nexus_get_defi_yields':
      return callNexusApi(`/api/v1/defi/yields${qs(args, ['chain', 'stablecoin', 'limit'])}`)
    case 'nexus_get_defi_overview':
      return callNexusApi('/api/v1/defi/overview')

    // ── News & Sentiment ───────────────────────────────────
    case 'nexus_get_news':
      return callNexusApi(`/api/v1/news${qs(args, ['category', 'limit'])}`)
    case 'nexus_get_feeds':
      return callNexusApi(`/api/v1/feeds${qs(args, ['limit'])}`)
    case 'nexus_get_news_intel':
      return callNexusApi('/api/v1/news-intel')
    case 'nexus_get_sentiment':
      return callNexusApi(`/api/v1/sentiment${qs(args, ['limit'])}`)
    case 'nexus_get_vimero':
      return callNexusApi('/api/v1/vimero')

    // ── Macro & TradFi ─────────────────────────────────────
    case 'nexus_get_macro':
      return callNexusApi('/api/v1/macro')
    case 'nexus_get_macro_indicators':
      return callNexusApi(`/api/v1/modules/fetch${qs({ module: 'fred', ...args }, ['module', 'series', 'limit'])}`)
    case 'nexus_get_tradfi':
      return callNexusApi('/api/v1/tradfi')
    case 'nexus_get_sectors':
      return callNexusApi('/api/v1/sectors')
    case 'nexus_get_forex':
      return callNexusApi('/api/v1/forex')
    case 'nexus_get_commodities':
      return callNexusApi('/api/v1/commodities')

    // ── Alt Data ───────────────────────────────────────────
    case 'nexus_get_alt_data':
      return callNexusApi('/api/v1/alt-data')
    case 'nexus_get_weather_signals':
      return callNexusApi('/api/v1/weather-signals')
    case 'nexus_get_gaps':
      return callNexusApi('/api/v1/gaps')

    // ── AI & Signals ───────────────────────────────────────
    case 'nexus_get_signals':
      return callNexusApi('/api/v1/signals')
    case 'nexus_get_signal_confidence':
      return callNexusApi('/api/v1/signal-confidence')
    case 'nexus_get_edge_report':
      return callNexusApi('/api/v1/edge-report')
    case 'nexus_get_alpha_feed':
      return callNexusApi('/api/v1/alpha-feed')
    case 'nexus_chat':
      return postNexusApi('/api/v1/ai/chat', {
        message: String(args.message ?? ''),
        agent: args.agent ? String(args.agent) : undefined,
      })

    // ── Predictions ────────────────────────────────────────
    case 'nexus_get_prediction_markets':
      return callNexusApi(`/api/v1/predictions${qs(args, ['limit'])}`)

    // ── Alerts ─────────────────────────────────────────────
    case 'nexus_get_alerts':
      return callNexusApi('/api/v1/alerts')
    case 'nexus_get_alert_templates':
      return callNexusApi('/api/v1/alerts/templates')

    // ── System ─────────────────────────────────────────────
    case 'nexus_get_status':
      return callNexusApi('/api/v1/status')
    case 'nexus_get_data_sources':
      return callNexusApi('/api/v1/data-sources')
    case 'nexus_get_module_status':
      return callNexusApi('/api/v1/modules')
    case 'nexus_get_telegram':
      return callNexusApi('/api/v1/telegram')
    case 'nexus_get_usage':
      return callNexusApi('/api/v1/usage')

    // ── Direct Module Access ───────────────────────────────
    case 'nexus_get_defillama':
      return callNexusApi(`/api/v1/modules/fetch${qs({ module: 'defillama', ...args }, ['module', 'action'])}`)
    case 'nexus_get_dex_pools':
      return callNexusApi(`/api/v1/modules/fetch${qs({ module: 'geckoterminal', ...args }, ['module', 'action', 'network', 'limit'])}`)

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── MCP JSON-RPC Handler ────────────────────────────────────

async function handleMcpRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const method = body.method as string
  const id = body.id

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nexus-mcp', version: '2.0.0' },
      },
    }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    }
  }

  if (method === 'tools/call') {
    const params = body.params as { name: string; arguments: Record<string, unknown> }
    try {
      const result = await handleToolCall(params.name, params.arguments ?? {})
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        },
      }
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}

// ─── Auth + CORS ─────────────────────────────────────────────

const MCP_API_KEYS = (process.env.NEXUS_API_KEYS || '')
  .split(',')
  .map((k) => k.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean)

const ALLOWED_ORIGINS = [
  'http://localhost:4400',
  'http://localhost:3000',
  'https://nexus.yourdomain.com',
]

function authenticateRequest(req: http.IncomingMessage): boolean {
  if (MCP_API_KEYS.length === 0) return true
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return false
  const token = auth.slice(7).trim()
  return MCP_API_KEYS.includes(token)
}

// ─── HTTP Server (SSE + JSON-RPC) ────────────────────────────

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Health check (no auth)
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', tools: TOOLS.length, version: '2.0.0' }))
    return
  }

  // Authenticate all non-health requests
  if (!authenticateRequest(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Missing or invalid API key. Use Authorization: Bearer <key>' }))
    return
  }

  // SSE endpoint for remote agents
  if (req.method === 'GET' && req.url === '/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write('data: {"type":"connected","tools":' + TOOLS.length + '}\n\n')
    const interval = setInterval(() => res.write('data: {"type":"ping"}\n\n'), 30_000)
    req.on('close', () => clearInterval(interval))
    return
  }

  // MCP JSON-RPC endpoint
  if (req.method === 'POST' && req.url === '/mcp') {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      const json = JSON.parse(body) as Record<string, unknown>
      const response = await handleMcpRequest(json)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(response))
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }))
    }
    return
  }

  // Tool list as REST (convenience)
  if (req.method === 'GET' && req.url === '/tools') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ tools: TOOLS.map(t => ({ name: t.name, description: t.description })) }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`NEXUS MCP Server v2.0.0 running on port ${PORT}`)
  console.log(`  Tools:  ${TOOLS.length}`)
  console.log(`  Health: http://localhost:${PORT}/health`)
  console.log(`  Tools:  http://localhost:${PORT}/tools`)
  console.log(`  SSE:    http://localhost:${PORT}/sse`)
  console.log(`  MCP:    POST http://localhost:${PORT}/mcp`)
})
