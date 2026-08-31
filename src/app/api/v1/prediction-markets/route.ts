// ─────────────────────────────────────────────────────────────
// GET /api/v1/prediction-markets — Aggregated prediction markets
// Sources: Polymarket, Manifold, Metaculus (zero API keys)
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  getAggregatedMarkets,
  getCrossPlatformMarkets,
} from '@/lib/modules/prediction/prediction-aggregator'
import { checkRateLimit } from '@/lib/api/rate-limit'

export async function GET(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const { allowed } = await checkRateLimit(`prediction-markets:${ip}`)
    if (!allowed) {
      return NextResponse.json(
        { data: null, error: 'Rate limit exceeded' },
        { status: 429 }
      )
    }

    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') ?? 'aggregate'
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))
    const source = searchParams.get('source') ?? undefined
    const category = searchParams.get('category') ?? undefined
    const sort = searchParams.get('sort') ?? 'volume24h'
    const order = searchParams.get('order') ?? 'desc'

    // Cross-platform correlation mode
    if (mode === 'cross-platform') {
      const crossPlatform = await getCrossPlatformMarkets()
      return NextResponse.json(
        { data: { crossPlatform, count: crossPlatform.length }, error: null },
        { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=240' } }
      )
    }

    // Default: aggregated markets
    const result = await getAggregatedMarkets({ limit, source, category, sort, order })

    return NextResponse.json(
      {
        data: {
          markets: result.markets,
          totalMarkets: result.totalMarkets,
          sources: result.sources,
          timestamp: result.timestamp,
        },
        error: null,
      },
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' } }
    )
  } catch (error) {
    console.error('Prediction markets aggregator error:', error)
    return NextResponse.json(
      { data: null, error: 'Failed to aggregate prediction markets' },
      { status: 502 }
    )
  }
}
