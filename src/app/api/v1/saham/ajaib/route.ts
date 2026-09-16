// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/ajaib — keyless Ajaib IDX data (no auth).
//   (default)      whole-universe snapshot + capturedAt meta
//   ?symbol=BBRI   analyst consensus + PE/PBV bands + technicals
// NOTE: per-symbol analysis is populated for IDX STOCK only
// (US/MF codes 404 here).
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getAjaibAnalysis, normalizeCode } from '@/lib/modules/market/provider/idx-ajaib/analysis'
import { getAjaibUniverse, EmptySnapshotError } from '@/lib/modules/market/provider/idx-ajaib/universe'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol')
  try {
    if (symbol) {
      const row = await getAjaibAnalysis(symbol)
      if (!row) return apiError(`No Ajaib analysis for '${symbol}' (IDX STOCK only)`, 404)
      return apiSuccess({ symbol: normalizeCode(symbol), ...row })
    }
    return apiSuccess(await getAjaibUniverse())
  } catch (error) {
    if (error instanceof EmptySnapshotError) {
      return apiError('No Ajaib snapshot yet — run npm run harvest:idx-ajaib (weekdays 19:05 cron)', 503)
    }
    return apiError((error as Error).message, 500)
  }
}
