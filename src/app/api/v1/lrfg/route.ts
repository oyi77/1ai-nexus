// ─────────────────────────────────────────────────────────────
// GET /api/v1/lrfg — Leverage Reset / Flow Gap events
// Premium analytics endpoint. Detects + persists leverage-reset
// events on each call, then returns recent events for the symbol.
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, cacheHeaders } from '@/lib/api/response'
import { detectAndStoreLrfg, fetchLrfgEvents, type LrfgEventDTO } from '@/lib/modules/derived/lrfg-engine'
import { cacheGet, cacheSet } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get('symbol') ?? 'BTCUSDT'
    const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10)))

    let events = await cacheGet<LrfgEventDTO[]>('lrfg:' + symbol)
    if (!events) {
      await detectAndStoreLrfg(symbol)
      events = await fetchLrfgEvents({ symbol, limit })
      cacheSet('lrfg:' + symbol, events, 60).catch(() => {})
    }
    return cacheHeaders(apiSuccess({ symbol, count: events.length, events }), 15)
  } catch (e) {
    return apiError('Failed to compute LRFG events', 502)
  }
}
