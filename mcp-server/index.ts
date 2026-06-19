// ─────────────────────────────────────────────────────────────
// NEXUS MCP Server
// Port 4402 · Transport: stdio + SSE
// Exposes all module data as MCP tools
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
  {
    name: 'nexus_get_whale_alerts',
    description: 'Get large transactions across chains',
    inputSchema: { type: 'object', properties: { chain: { type: 'string' }, minUsd: { type: 'number' } } },
  },
  {
    name: 'nexus_get_market_snapshot',
    description: 'Get current prices, dominance, and market cap',
    inputSchema: { type: 'object', properties: { symbols: { type: 'string', description: 'Comma-separated symbols' } } },
  },
  {
    name: 'nexus_get_fear_greed',
    description: 'Get crypto Fear & Greed Index',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_defi_tvl',
    description: 'Get DeFi TVL from DeFiLlama',
    inputSchema: { type: 'object', properties: { chain: { type: 'string' }, limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_dex_pools',
    description: 'Get trending DEX pools from GeckoTerminal',
    inputSchema: { type: 'object', properties: { network: { type: 'string' }, limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_macro_indicators',
    description: 'Get macro economic data (FRED: rates, CPI, GDP)',
    inputSchema: { type: 'object', properties: { series: { type: 'string', description: 'FRED series ID' } } },
  },
  {
    name: 'nexus_get_news_feed',
    description: 'Get aggregated news from RSS + Reddit',
    inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['crypto', 'macro', 'regulatory', 'tradfi'] }, limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_derivatives',
    description: 'Get derivatives data (OI, funding, liquidations)',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, action: { type: 'string', enum: ['open-interest', 'funding'] } } },
  },
  {
    name: 'nexus_get_prediction_markets',
    description: 'Get Polymarket prediction market data',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'nexus_trace_wallet',
    description: 'Get wallet profile with entity label and PnL',
    inputSchema: { type: 'object', properties: { address: { type: 'string' }, chain: { type: 'string' } }, required: ['address'] },
  },
  {
    name: 'nexus_get_token_intelligence',
    description: 'Get token analytics (holders, smart money %, price)',
    inputSchema: { type: 'object', properties: { address: { type: 'string' }, network: { type: 'string' } }, required: ['address'] },
  },
  {
    name: 'nexus_get_module_status',
    description: 'Get status of all data modules',
    inputSchema: { type: 'object', properties: {} },
  },
]

async function callNexusApi(path: string): Promise<unknown> {
  const res = await fetch(`${NEXUS_API}${path}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Nexus API ${res.status}: ${path}`)
  return res.json()
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'nexus_get_market_snapshot':
      return callNexusApi(`/api/v1/market/prices`)
    case 'nexus_get_fear_greed':
      return callNexusApi(`/api/v1/market/sentiment`)
    case 'nexus_get_news_feed': {
      const params = new URLSearchParams()
      if (args.category) params.set('category', String(args.category))
      if (args.limit) params.set('limit', String(args.limit))
      return callNexusApi(`/api/v1/news?${params}`)
    }
    case 'nexus_get_defi_tvl':
      return callNexusApi(`/api/v1/modules/fetch?module=defillama&action=protocols`)
    case 'nexus_get_dex_pools': {
      const params = new URLSearchParams({ action: 'trending' })
      if (args.network) params.set('network', String(args.network))
      if (args.limit) params.set('limit', String(args.limit))
      return callNexusApi(`/api/v1/modules/fetch?module=geckoterminal&${params}`)
    }
    case 'nexus_get_macro_indicators': {
      const series = String(args.series ?? 'FEDFUNDS')
      return callNexusApi(`/api/v1/modules/fetch?module=fred&series=${series}&limit=10`)
    }
    case 'nexus_get_derivatives': {
      const action = String(args.action ?? 'open-interest')
      const symbol = String(args.symbol ?? 'BTCUSDT')
      return callNexusApi(`/api/v1/modules/fetch?module=derivatives-aggregate&action=${action}&symbol=${symbol}`)
    }
    case 'nexus_get_prediction_markets':
      return callNexusApi(`/api/v1/modules/fetch?module=polymarket&action=markets&limit=${args.limit ?? 20}`)
    case 'nexus_trace_wallet': {
      const address = String(args.address)
      const chain = String(args.chain ?? 'eth')
      return callNexusApi(`/api/v1/modules/fetch?module=blockscout-eth&action=txlist&address=${address}&chain=${chain}`)
    }
    case 'nexus_get_module_status':
      return callNexusApi(`/api/v1/modules`)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// MCP JSON-RPC handler
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
        serverInfo: { name: 'nexus-mcp', version: '1.0.0' },
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
        result: { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true },
      }
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
}

// HTTP server for SSE transport
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', tools: TOOLS.length }))
    return
  }

  if (req.method === 'GET' && req.url === '/sse') {
    // SSE endpoint for remote agents
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write('data: {"type":"connected"}\n\n')
    // Keep alive
    const interval = setInterval(() => res.write('data: {"type":"ping"}\n\n'), 30_000)
    req.on('close', () => clearInterval(interval))
    return
  }

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

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`NEXUS MCP Server running on port ${PORT}`)
  console.log(`  Tools: ${TOOLS.length}`)
  console.log(`  Health: http://localhost:${PORT}/health`)
  console.log(`  SSE:    http://localhost:${PORT}/sse`)
  console.log(`  MCP:    POST http://localhost:${PORT}/mcp`)
})
