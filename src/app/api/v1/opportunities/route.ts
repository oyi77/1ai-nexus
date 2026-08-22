// ─────────────────────────────────────────────────────────────
// GET /api/v1/opportunities — Unified Opportunity Ranker (P5)
// Aggregates alpha / arbitrage / launch-alpha / LRFG / SFC signals
// into one ranked list, persists, and alerts top-N.
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { rankAndPersist, fetchOpportunities, type Opportunity } from '@/lib/modules/derived/opportunity-ranker'
import { cacheGet, cacheSet } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)))
    const cacheKey = 'opportunities:' + limit
    let rows = await cacheGet<Opportunity[]>(cacheKey)
    if (!rows) {
      await rankAndPersist()
      rows = await fetchOpportunities(limit)
      cacheSet(cacheKey, rows, 120).catch(() => {})
    }
    return apiSuccess({ count: rows.length, opportunities: rows })
  } catch (e) {
    return apiError('Failed to rank opportunities', 502)
  }
}
