// ─────────────────────────────────────────────────────────────
// GET /api/v1/gaps — Microstructure dislocation signals
// ?action=kimchi|basis|weekend|correlation|all
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  getKimchiPremium,
  getKimchiHistory,
  getCrossExchangeBasis,
  getAllBases,
  getWeekendGap,
  getWeekendDriftCorrelation,
  getAllGapSignals,
} from '@/lib/dal/microstructure'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'all'
  const symbol = searchParams.get('symbol') ?? 'BTCUSDT'
  const asset = searchParams.get('asset') ?? 'BTC'

  try {
    if (action === 'kimchi') {
      const [premium, history] = await Promise.all([
        getKimchiPremium(),
        getKimchiHistory(asset),
      ])
      return NextResponse.json(
        { data: { premium, history }, error: null },
        { headers: { 'Cache-Control': 'public, max-age=15' } },
      )
    }

    if (action === 'basis') {
      const bases = await getCrossExchangeBasis(symbol)
      return NextResponse.json(
        { data: bases, error: null },
        { headers: { 'Cache-Control': 'public, max-age=15' } },
      )
    }

    if (action === 'weekend') {
      const [gap, drift] = await Promise.all([
        getWeekendGap(symbol),
        getWeekendDriftCorrelation(),
      ])
      return NextResponse.json(
        { data: { gap, drift }, error: null },
        { headers: { 'Cache-Control': 'public, max-age=60' } },
      )
    }

    if (action === 'correlation') {
      const drift = await getWeekendDriftCorrelation()
      return NextResponse.json(
        { data: drift, error: null },
        { headers: { 'Cache-Control': 'public, max-age=60' } },
      )
    }

    // Default: all signals ranked by |z-score|
    const signals = await getAllGapSignals()
    return NextResponse.json(
      { data: signals, count: signals.length, error: null },
      { headers: { 'Cache-Control': 'public, max-age=15' } },
    )
  } catch (err) {
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 502 },
    )
  }
}
