// ─────────────────────────────────────────────────────────────
// GET /api/v1/market-ticks — Recent unified DEX + CEX price ticks
// Foundation endpoint for the DEX/CEX lead-lag matrix (P4) and the
// opportunity ranker (P5). Returns both venues for an asset so the
// caller can align timestamps and compute repricing latency.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const limit = Math.min(2000, Math.max(10, parseInt(searchParams.get('limit') ?? '500', 10)))

  if (!symbol) return apiError('symbol parameter required', 400)

  try {
    const rows = await prisma.marketSnapshot.findMany({
      where: { symbol },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })
    const series = rows.map((r) => ({
      symbol: r.symbol,
      venue: r.sourceId,
      price: r.price,
      timestamp: r.timestamp,
    }))
    return apiSuccess({ symbol, count: series.length, series })
  } catch (e) {
    return apiError('Failed to load market ticks', 500)
  }
}
