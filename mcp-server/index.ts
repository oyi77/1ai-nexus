// NEXUS MCP Server -- thin facade: HTTP + SSE boot, barrel re-export.
// Port 4402 - Transport: HTTP + SSE
// Exposes ALL NEXUS API routes as MCP tools

import http from 'node:http'
import { PORT } from './types'
import { TOOLS } from './tools'
import { handleMcpRequest } from './protocol'

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

export * from './types'
export * from './tools'
export * from './client'
export * from './router'
export * from './protocol'
