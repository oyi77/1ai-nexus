// ─────────────────────────────────────────────────────────────
// GET /api/v1/arbitrage — Real-time cross-exchange arbitrage
// Delegates to arbitrage-engine.scanArbitrage() (Binance/Bybit/OKX
// price spreads, funding differentials, spot-perp basis). Replaces
// the prior inline Binance-only implementation.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'
import scanArbitrage, { type ArbitrageSnapshot } from '@/lib/modules/market/arbitrage-engine'

async function runScan(): Promise<ArbitrageSnapshot> {
  return scanArbitrage({ minSpreadBps: 3, minFundingBps: 50, minBasisPercent: 0.5 })
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached<ArbitrageSnapshot>('arbitrage', 10_000, runScan)
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=20')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Arbitrage error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch arbitrage data' }, { status: 502 })
  }
}
