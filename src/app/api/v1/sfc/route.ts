// ─────────────────────────────────────────────────────────────
// GET /api/v1/sfc — Smart-Flow Convergence
//   ?token=SYM  → per-token SFC convergence (Σ PWSᵢ×independenceᵢ)
//   (no token)  → SmartMoneyWallet score leaderboard
// Premium analytics endpoint; refreshes scores then returns data.
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  refreshSmartMoneyScores,
  fetchSmartMoneyScores,
  computeSfcConvergence,
  type SmartMoneyScoreRow,
  type SfcConvergence,
} from '@/lib/modules/derived/sfc-engine'
import { cacheGet, cacheSet } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const token = sp.get('token')

    if (token) {
      const cacheKey = 'sfc:conv:' + token
      let conv: SfcConvergence | null = await cacheGet<SfcConvergence>(cacheKey)
      if (!conv) {
        await refreshSmartMoneyScores()
        conv = await computeSfcConvergence(token)
        cacheSet(cacheKey, conv, 300).catch(() => {})
      }
      return apiSuccess({ token, convergence: conv })
    }

    const category = sp.get('category') ?? undefined
    const minScore = sp.get('minScore') ? parseInt(sp.get('minScore')!, 10) : undefined
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)))

    const cacheKey = 'sfc:' + [category ?? 'all', minScore ?? '0', limit].join(':')
    let rows = await cacheGet<SmartMoneyScoreRow[]>(cacheKey)
    if (!rows) {
      await refreshSmartMoneyScores()
      rows = await fetchSmartMoneyScores({ limit, category, minScore })
      cacheSet(cacheKey, rows, 300).catch(() => {})
    }
    return apiSuccess({ count: rows.length, wallets: rows })
  } catch {
    return apiError('Failed to compute SFC', 502)
  }
}
