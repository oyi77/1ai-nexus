// ─────────────────────────────────────────────────────────────
// GET /api/v1/history?symbol=BTC&interval=1h&limit=100
// Returns OHLCV candles from historical price snapshots
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { buildOhlcv, getSnapshots, getSnapshotCount, getSymbolCount } from '@/lib/modules/derived/price-store'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') ?? 'BTC').toUpperCase()
  const interval = searchParams.get('interval') ?? '1h'
  const limit = Math.min(500, Math.max(10, Number(searchParams.get('limit') ?? 100)))

  const intervalMs: Record<string, number> = {
    '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000,
    '4h': 14_400_000, '1d': 86_400_000,
  }
  const ms = intervalMs[interval] ?? 3_600_000

  const candles = buildOhlcv(symbol, ms, limit)
  const snapshots = getSnapshots(symbol)

  return NextResponse.json({
    symbol,
    interval,
    candles,
    snapshotCount: snapshots.length,
    totalSnapshots: getSnapshotCount(),
    totalSymbols: getSymbolCount(),
  })
}
