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
      // Provenance: history includes the 2026-09-18 flood (338 dupes/symbol
      // through a bare create on 15-60s TTL recomputes). Dedup enforced for
      // new emissions; the population rate is flood-diluted, NOT the edge.
      // Edge lives in the gated subset (alphaScore>=68: Sept OOS 38.3% /
      // +0.64 vs <68 33.1% / +0.13).
      provenance: {
        floodNote: '2026-09-18 flood rows included; population rate diluted',
        edgeSubset: 'alphaScore>=68: Sept OOS hit 38.3% avg +0.64',
        dedupSince: '2026-09-22',
      },
    })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    return resp
  } catch {
    return apiJson({
      total: 0, evaluated: 0, overallWinRate: 0, buckets: [], lastEvaluation: null,
    })
  }
}