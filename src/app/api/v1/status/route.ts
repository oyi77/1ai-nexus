import { NextResponse } from 'next/server'

interface ServiceStatus {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  details?: string
}

async function checkService(name: string, url: string, timeoutMs = 5000): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'application/json' },
    })
    const latencyMs = Date.now() - start
    if (res.ok) {
      return { name, status: 'healthy', latencyMs }
    }
    return { name, status: 'degraded', latencyMs, details: `HTTP ${res.status}` }
  } catch (err) {
    const latencyMs = Date.now() - start
    return { name, status: 'down', latencyMs, details: (err as Error).message }
  }
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4401'

  const checks = await Promise.allSettled([
    checkService('Web App', `${baseUrl}/api/v1/fear-greed`),
    checkService('WebSocket', (wsUrl.replace('ws://', 'http://').replace('wss://', 'https://')) + '/health'),
    checkService('DeFiLlama', 'https://api.llama.fi/protocols'),
    checkService('CoinGecko', 'https://api.coingecko.com/api/v3/ping'),
    checkService('Mempool.space', 'https://mempool.space/api/v1/fees/recommended'),
    checkService('Binance', 'https://api.binance.com/api/v3/ping'),
  ])

  const services: ServiceStatus[] = checks.map((c) =>
    c.status === 'fulfilled' ? c.value : { name: 'Unknown', status: 'down' as const, latencyMs: 0, details: 'Check failed' }
  )

  const overallStatus = services.every((s) => s.status === 'healthy')
    ? 'healthy'
    : services.some((s) => s.status === 'down')
    ? 'down'
    : 'degraded'

  return NextResponse.json({
    data: {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services,
      uptime: process.uptime(),
    },
    meta: null,
    error: null,
  }, {
    headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' },
  })
}
