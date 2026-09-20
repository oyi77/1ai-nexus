// ─────────────────────────────────────────────────────────────
// GET /api/v1/insight-brief — cross-domain transmission brief (SERVER-ONLY).
// Fused read: perps crowding + IDX foreign flow + sector rotation +
// sentiment extremes, each with measured or explicitly-unproven confidence.
// Public (ALWAYS_PUBLIC) — the credibility surface.
// ─────────────────────────────────────────────────────────────
import { type NextRequest } from 'next/server'
import { apiSuccess, apiError, cacheHeaders } from '@/lib/api/response'
import { buildInsightBrief } from '@/lib/modules/derived/insight-brief'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    const brief = await buildInsightBrief()
    return cacheHeaders(apiSuccess(brief), 300)
  } catch {
    return apiError('Failed to build insight brief', 502)
  }
}
