// NEXUS MCP Server -- tool router.

import { callNexusApi, postNexusApi, qs } from './client'

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
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

    // ── Token Terminal ───────────────────────────────────
    case 'nexus_get_token_terminal':
      return callNexusApi(`/api/v1/modules/fetch${qs({ module: 'tokenterminal', ...args }, ['module', 'action', 'project', 'limit'])}`)

    // ── Arkham Intelligence ──────────────────────────────
    case 'nexus_get_arkham_entity':
      return callNexusApi(`/api/v1/arkham/entity${qs(args, ['address', 'chain'])}`)
    case 'nexus_get_arkham_portfolio':
      return callNexusApi(`/api/v1/arkham/portfolio${qs(args, ['entity'])}`)
    case 'nexus_search_arkham_entities':
      return callNexusApi(`/api/v1/arkham/search${qs(args, ['query'])}`)

    // ── The Graph Subgraphs ──────────────────────────────
    case 'nexus_query_subgraph':
      return postNexusApi('/api/v1/thegraph/query', { subgraph: String(args.subgraph), query: String(args.query), variables: args.variables })
    case 'nexus_get_uniswap_pools':
      return callNexusApi(`/api/v1/thegraph/uniswap${qs(args, ['chain', 'limit'])}`)
    case 'nexus_get_aave_reserves':
      return callNexusApi(`/api/v1/thegraph/aave${qs(args, ['chain', 'limit'])}`)
    case 'nexus_get_gmx_markets':
      return callNexusApi(`/api/v1/thegraph/gmx${qs(args, ['chain'])}`)
    case 'nexus_get_lido_data':
      return callNexusApi('/api/v1/thegraph/lido')
    case 'nexus_get_curve_pools':
      return callNexusApi(`/api/v1/thegraph/curve${qs(args, ['limit'])}`)
    case 'nexus_get_top_defi_metrics':
      return callNexusApi('/api/v1/thegraph/top-defi')

    // ── Sentiment (X API + LunarCrush) ───────────────────
    case 'nexus_get_sentiment_x':
      return callNexusApi(`/api/v1/sentiment/x${qs(args, ['asset', 'limit'])}`)
    case 'nexus_get_sentiment_lunarcrush':
      return callNexusApi(`/api/v1/sentiment/lunarcrush${qs(args, ['assets'])}`)
    case 'nexus_get_aggregated_sentiment':
      return callNexusApi(`/api/v1/sentiment/aggregated${qs(args, ['asset'])}`)

    // ── Macro (FRED + CoinMetrics) ───────────────────────
    case 'nexus_get_fred_macro':
      return callNexusApi(`/api/v1/macro/fred${qs(args, ['series'])}`)
    case 'nexus_get_fred_all':
      return callNexusApi('/api/v1/macro/fred/all')
    case 'nexus_get_coinmetrics':
      return callNexusApi(`/api/v1/macro/coinmetrics${qs(args, ['assets', 'metrics'])}`)
    case 'nexus_get_macro_regime':
      return callNexusApi('/api/v1/macro/regime')
    case 'nexus_get_cycle_indicators':
      return callNexusApi(`/api/v1/macro/cycle${qs(args, ['asset'])}`)

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
