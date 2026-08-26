import { NextResponse } from 'next/server'

interface ServiceStatus {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  details?: string
  category: 'core' | 'crypto' | 'tradfi' | 'macro'
}

async function checkService(name: string, url: string, category: ServiceStatus['category'], timeoutMs = 5000): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'application/json' },
    })
    const latencyMs = Date.now() - start
    if (res.ok) {
      return { name, status: 'healthy', latencyMs, category }
    }
    return { name, status: 'degraded', latencyMs, details: `HTTP ${res.status}`, category }
  } catch (err) {
    const latencyMs = Date.now() - start
    return { name, status: 'down', latencyMs, details: (err as Error).message, category }
  }
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'wss://tracker-ws.aitradepulse.com'

  const checks = await Promise.allSettled([
    // Core infrastructure
    checkService('Web App', `${baseUrl}/api/v1/fear-greed`, 'core'),
    checkService('WebSocket', (wsUrl.replace('ws://', 'http://').replace('wss://', 'https://')) + '/health', 'core'),

    // Crypto data sources
    checkService('DeFiLlama', 'https://api.llama.fi/protocols', 'crypto'),
    checkService('CoinGecko', 'https://api.coingecko.com/api/v3/ping', 'crypto'),
    checkService('Mempool.space', 'https://mempool.space/api/v1/fees/recommended', 'crypto'),
    checkService('Binance', 'https://api.binance.com/api/v3/ping', 'crypto'),

    // TradFi data sources
    checkService('Yahoo Finance', 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d', 'tradfi', 8000),
    checkService('ExchangeRate API', 'https://open.er-api.com/v6/latest/USD', 'tradfi'),
    checkService('US Treasury', 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/2026?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv', 'tradfi', 10000),

    // Macro data sources
    checkService('World Bank', 'https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=1', 'macro'),
    checkService('FRED API', process.env.FRED_API_KEY
      ? `https://api.stlouisfed.org/fred/series?series_id=FEDFUNDS&api_key=${process.env.FRED_API_KEY}&file_type=json`
      : 'https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=1', 'macro'),
    checkService('DexScreener', 'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112', 'crypto'),
  ])

  const services: ServiceStatus[] = checks.map((c) =>
    c.status === 'fulfilled' ? c.value : { name: 'Unknown', status: 'down' as const, latencyMs: 0, details: 'Check failed', category: 'core' as const }
  )

  const overallStatus = services.every((s) => s.status === 'healthy')
    ? 'healthy'
    : services.some((s) => s.status === 'down')
    ? 'down'
    : 'degraded'

  // Group by category for structured response
  const byCategory = {
    core: services.filter(s => s.category === 'core'),
    crypto: services.filter(s => s.category === 'crypto'),
    tradfi: services.filter(s => s.category === 'tradfi'),
    macro: services.filter(s => s.category === 'macro'),
  }

  return NextResponse.json({
    data: {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services,
      byCategory,
      summary: {
        total: services.length,
        healthy: services.filter(s => s.status === 'healthy').length,
        degraded: services.filter(s => s.status === 'degraded').length,
        down: services.filter(s => s.status === 'down').length,
      },
      uptime: process.uptime(),
    },
    meta: null,
    error: null,
  }, {
    headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' },
  })
}
