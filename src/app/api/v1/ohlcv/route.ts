// ─────────────────────────────────────────────────────────────
// GET /api/v1/ohlcv?symbol=BTC&interval=1h&limit=100&indicators=sma20,rsi14,macd
// Returns REAL OHLCV candles from Binance public klines API
// No API key required. 30s server cache. 429 retry with backoff.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import { sma, ema, rsi, macd, bollingerBands } from '@/lib/modules/derived/indicators'
import type { OhlcvCandle } from '@/lib/modules/derived/price-store'

// Map user-facing symbols to Binance trading pairs (USDT quote)
const SYMBOL_TO_BINANCE: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  BNB: 'BNBUSDT',
  XRP: 'XRPUSDT',
  ADA: 'ADAUSDT',
  DOGE: 'DOGEUSDT',
  AVAX: 'AVAXUSDT',
  DOT: 'DOTUSDT',
  MATIC: 'MATICUSDT',
  LINK: 'LINKUSDT',
}

// Binance klines intervals → supported set
const VALID_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M',
])

// Binance kline tuple element indices
const KL_OPEN_TIME = 0
const KL_OPEN = 1
const KL_HIGH = 2
const KL_LOW = 3
const KL_CLOSE = 4
const KL_VOLUME = 5

type BinanceKline = [number, string, string, string, string, string, ...unknown[]]

function isBinanceKlineArray(data: unknown): data is BinanceKline[] {
  if (!Array.isArray(data)) return false
  return data.every(row =>
    Array.isArray(row) &&
    row.length >= 6 &&
    typeof row[KL_OPEN_TIME] === 'number' &&
    typeof row[KL_OPEN] === 'string' &&
    typeof row[KL_HIGH] === 'string' &&
    typeof row[KL_LOW] === 'string' &&
    typeof row[KL_CLOSE] === 'string' &&
    typeof row[KL_VOLUME] === 'string',
  )
}

/**
 * Fetch candles from Binance public klines API with 429 retry + backoff.
 * No API key required.
 */
async function fetchBinanceKlines(
  binanceSymbol: string,
  interval: string,
  limit: number,
): Promise<OhlcvCandle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`
  const MAX_RETRIES = 3

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Never cache at fetch layer; server-cache handles TTL
      cache: 'no-store',
    })

    // 429 Too Many Requests — back off and retry
    if (res.status === 429) {
      const retryAfterMs = Number(res.headers.get('Retry-After') ?? 0) * 1000
      const backoff = retryAfterMs || Math.min(2000 * 2 ** attempt, 8000)
      if (attempt < MAX_RETRIES - 1) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, backoff)
        await promise
        continue
      }
      throw new Error(`Binance API rate limited (429) after ${MAX_RETRIES} retries`)
    }

    // 418 IP banned — non-retryable
    if (res.status === 418) {
      throw new Error('Binance API temporarily banned this IP (418)')
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Binance API error ${res.status}: ${body.slice(0, 200)}`)
    }

    const json: unknown = await res.json()
    if (!isBinanceKlineArray(json)) {
      throw new Error('Binance API returned unexpected kline format')
    }

    return json.map(k => ({
      time: Math.floor(k[KL_OPEN_TIME] / 1000),
      open: parseFloat(k[KL_OPEN]),
      high: parseFloat(k[KL_HIGH]),
      low: parseFloat(k[KL_LOW]),
      close: parseFloat(k[KL_CLOSE]),
      volume: parseFloat(k[KL_VOLUME]),
    }))
  }

  // Unreachable: loop either returns or throws
  throw new Error(`Binance API failed for ${binanceSymbol} after ${MAX_RETRIES} attempts`)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') ?? 'BTC').toUpperCase()
  const interval = searchParams.get('interval') ?? '1h'
  const limit = Math.min(1000, Math.max(1, Number(searchParams.get('limit') ?? 100)))
  const indicatorsParam = searchParams.get('indicators') ?? ''

  // Resolve Binance trading pair
  const binanceSymbol =
    SYMBOL_TO_BINANCE[symbol] ??
    (symbol.endsWith('USDT') ? symbol : `${symbol}USDT`)

  // Validate interval
  const safeInterval = VALID_INTERVALS.has(interval) ? interval : '1h'

  const cacheKey = `ohlcv:binance:${binanceSymbol}:${safeInterval}:${limit}`

  let candles: OhlcvCandle[]
  let fromCache: boolean
  try {
    const result = await getCached(
      cacheKey,
      30_000,
      () => fetchBinanceKlines(binanceSymbol, safeInterval, limit),
    )
    candles = result.data
    fromCache = result.fromCache
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Binance klines'
    return NextResponse.json(
      { data: null, error: message },
      { status: 502 },
    )
  }

  // Compute requested indicators from real candles
  const indicatorResults: Record<string, unknown> = {}
  if (indicatorsParam && candles.length > 0) {
    const requested = indicatorsParam.split(',').map(s => s.trim().toLowerCase())

    for (const ind of requested) {
      if (ind.startsWith('sma')) {
        const period = parseInt(ind.replace('sma', '')) || 20
        indicatorResults[`SMA${period}`] = sma(candles, period)
      } else if (ind.startsWith('ema')) {
        const period = parseInt(ind.replace('ema', '')) || 20
        indicatorResults[`EMA${period}`] = ema(candles, period)
      } else if (ind === 'rsi' || ind.startsWith('rsi')) {
        const period = parseInt(ind.replace('rsi', '')) || 14
        indicatorResults[`RSI${period}`] = rsi(candles, period)
      } else if (ind === 'macd') {
        indicatorResults['MACD'] = macd(candles)
      } else if (ind === 'bb' || ind === 'bollinger') {
        indicatorResults['BB'] = bollingerBands(candles)
      }
    }
  }

  return NextResponse.json(
    {
      data: {
        symbol,
        binanceSymbol,
        interval: safeInterval,
        candles,
        indicators: indicatorResults,
        count: candles.length,
        cached: fromCache,
        source: 'binance',
      },
      error: null,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    },
  )
}