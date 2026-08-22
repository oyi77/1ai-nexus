// ─────────────────────────────────────────────────────────────
// GET /api/v1/launch-alpha — Launch Alpha scored tokens
// Premium analytics endpoint. Ingests + scores new DEX tokens on
// each call, then returns the ranked Launch Alpha list.
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { ingestLaunchTokens, fetchLaunchAlpha, type LaunchAlphaToken } from '@/lib/modules/derived/launch-alpha-engine'
import { cacheGet, cacheSet } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const chain = sp.get('chain') ?? undefined
    const minScore = sp.get('minScore') ? parseInt(sp.get('minScore')!, 10) : undefined
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)))

    const cacheKey = 'launch-alpha:' + [chain ?? 'all', minScore ?? '0', limit].join(':')
    let rows = await cacheGet<LaunchAlphaToken[]>(cacheKey)
    if (!rows) {
      await ingestLaunchTokens()
      rows = await fetchLaunchAlpha({ chain, limit, minScore })
      cacheSet(cacheKey, rows, 120).catch(() => {})
    }
    return apiSuccess({ count: rows.length, tokens: rows })
  } catch (e) {
    return apiError('Failed to compute Launch Alpha', 502)
  }
}
