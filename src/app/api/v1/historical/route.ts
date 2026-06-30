import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

// GET /api/v1/historical — Historical OHLCV data for any symbol
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const interval = searchParams.get('interval') ?? '1d'
  const range = searchParams.get('range') ?? '1y'
  const limit = Math.min(Number(searchParams.get('limit') ?? '500'), 2000)

  if (!symbol) {
    return apiJson(null, { error: 'Missing required param: symbol', status: 400 })
  }

  try {
    // Fetch from Yahoo Finance
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nexus-tracker/1.0)' },
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      return apiJson(null, { error: `Yahoo Finance ${res.status}`, status: 502 })
    }

    const data = await res.json() as {
      chart?: {
        result?: Array<{
          timestamp?: number[]
          meta?: Record<string, unknown>
          indicators?: {
            quote?: Array<{
              open?: number[]
              high?: number[]
              low?: number[]
              close?: number[]
              volume?: number[]
            }>
          }
        }>
      }
    }

    const result = data.chart?.result?.[0]
    if (!result?.timestamp || !result.indicators?.quote?.[0]) {
      return apiJson(null, { error: 'No data available', status: 404 })
    }

    const timestamps = result.timestamp
    const quotes = result.indicators.quote[0]
    const meta = result.meta ?? {}

    // Build OHLCV array
    const candles: Array<{
      time: string
      timestamp: number
      open: number
      high: number
      low: number
      close: number
      volume: number
    }> = []

    for (let i = 0; i < timestamps.length && candles.length < limit; i++) {
      const open = quotes.open?.[i]
      const high = quotes.high?.[i]
      const low = quotes.low?.[i]
      const close = quotes.close?.[i]
      const volume = quotes.volume?.[i]

      if (open != null && high != null && low != null && close != null) {
        candles.push({
          time: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          timestamp: timestamps[i],
          open,
          high,
          low,
          close,
          volume: volume ?? 0,
        })
      }
    }

    return apiJson({
      symbol,
      interval,
      range,
      currency: (meta.currency as string) ?? 'USD',
      exchange: (meta.exchangeName as string) ?? '',
      candles,
      count: candles.length,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 502 })
  }
}
