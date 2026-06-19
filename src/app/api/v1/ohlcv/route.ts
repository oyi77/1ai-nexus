// ─────────────────────────────────────────────────────────────
// GET /api/v1/ohlcv?symbol=BTC&interval=1h&limit=100&indicators=sma20,rsi14,macd
// Returns OHLCV candles with optional technical indicators
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { buildOhlcv, getSnapshotCount, getSymbolCount } from '@/lib/modules/derived/price-store'
import { sma, ema, rsi, macd, bollingerBands } from '@/lib/modules/derived/indicators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') ?? 'BTC').toUpperCase()
  const interval = searchParams.get('interval') ?? '1h'
  const limit = Math.min(500, Math.max(20, Number(searchParams.get('limit') ?? 100)))
  const indicatorsParam = searchParams.get('indicators') ?? ''

  const intervalMs: Record<string, number> = {
    '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000,
    '4h': 14_400_000, '1d': 86_400_000,
  }
  const ms = intervalMs[interval] ?? 3_600_000

  const candles = buildOhlcv(symbol, ms, limit)

  // Compute requested indicators
  const indicatorResults: Record<string, unknown> = {}
  if (indicatorsParam) {
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

  return NextResponse.json({
    symbol,
    interval,
    candles,
    indicators: indicatorResults,
    snapshotCount: getSnapshotCount(),
    totalSymbols: getSymbolCount(),
  })
}
