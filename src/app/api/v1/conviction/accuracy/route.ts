// ─────────────────────────────────────────────────────────────
// GET /api/v1/conviction/accuracy — the PROOF layer.
// Win-rate of past conviction signals by score bucket.
// Answers the trust question: "does >80 conviction actually win?"
// Public (ALWAYS_PUBLIC) — credibility is a growth asset.
// ─────────────────────────────────────────────────────────────

import { apiJson } from '@/lib/api/response'
import { getTrackAccuracy, evaluateTrackRecord } from '@/lib/conviction/track-record'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Evaluate any matured signals first (idempotent; only new ones).
    const evalResult = await evaluateTrackRecord().catch(() => ({ evaluated: 0, wins: 0, losses: 0, winRate: 0 }))
    const accuracy = await getTrackAccuracy()
    const resp = apiJson({
      ...accuracy,
      lastEvaluation: evalResult,
    })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    return resp
  } catch {
    return apiJson({
      total: 0, evaluated: 0, overallWinRate: 0, buckets: [], lastEvaluation: null,
    })
  }
}