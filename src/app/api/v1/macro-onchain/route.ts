// ─────────────────────────────────────────────────────────────
// GET /api/v1/macro-onchain — BTC on-chain macro metrics
// MVRV, SOPR, NVT derived from CoinGecko + Blockstream
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  fetchOnchainMacro,
  getLatestMacro,
} from '@/lib/modules/derived/onchain-macro'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Return cached data if fresh, otherwise fetch fresh
    const cached = getLatestMacro()
    if (cached) {
      return NextResponse.json({
        data: {
          ...cached,
          timestamp: cached.timestamp.toISOString(),
        },
        source: 'cache',
        error: null,
      }, {
        headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200' },
      })
    }

    const macro = await fetchOnchainMacro()

    return NextResponse.json({
      data: {
        ...macro,
        timestamp: macro.timestamp.toISOString(),
      },
      source: 'live',
      error: null,
    }, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch on-chain macro metrics'
    return NextResponse.json(
      { data: null, source: 'error', error: message },
      { status: 502 },
    )
  }
}
