// ─────────────────────────────────────────────────────────────
// GET /api/v1/lead-lag — DEX/CEX repricing lead-lag matrix
//   ?asset=SYM  → compute+return lead-lag for one asset
//   (no asset)  → return stored LeadLagMatrix rows
// Premium analytics: measures repricing latency between DEX and
// CEX price streams for the same asset.
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeAndStoreLeadLag, fetchLeadLag } from '@/lib/modules/derived/lead-lag-engine'
import type { LeadLagMatrix } from '@prisma/client'
import { cacheGet, cacheSet } from '@/lib/cache'
import { LEAD_LAG_WATCHLIST as WATCHLIST } from '@/lib/config/universe'

export const dynamic = 'force-dynamic'

// Compute one asset without ever 502-ing the whole request.
// A source/table hiccup for a single asset is non-fatal.
async function safeCompute(asset: string): Promise<void> {
  try {
    await computeAndStoreLeadLag(asset)
  } catch {
    // Per-asset failure is tolerated; the matrix simply stays empty for it.
  }
}

export async function GET(request: NextRequest) {
  try {
    const asset = request.nextUrl.searchParams.get('asset')
    if (asset) {
      const cacheKey = 'leadlag:' + asset
      let row = await cacheGet<LeadLagMatrix | null>(cacheKey)
      if (!row) {
        await safeCompute(asset)
        const rows = await fetchLeadLag(asset)
        row = rows[0] ?? null
        cacheSet(cacheKey, row, 600).catch(() => {})
      }
      return apiSuccess({ asset, matrix: row })
    }

    const cacheKey = 'leadlag:all'
    let rows = await cacheGet<LeadLagMatrix[]>(cacheKey)
    if (!rows) {
      await Promise.all(WATCHLIST.map((a) => safeCompute(a)))
      rows = await fetchLeadLag()
      cacheSet(cacheKey, rows, 600).catch(() => {})
    }
    return apiSuccess({ count: rows.length, matrix: rows })
  } catch {
    return apiError('Failed to compute lead-lag', 502)
  }
}
