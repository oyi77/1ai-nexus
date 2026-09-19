// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/intel — fused IDX intel verdict per stock.
//   ?symbol=BBCA   single-stock report (foreign + bandar + guru +
//                  analyst + fundamentals → verdict + score)
//   ?top=20        ranked universe by score
// Empty DB → 503. Unknown symbol → 404.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getIntelReport, getTopIntel } from '@/lib/modules/market/provider/idx-intel'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  try {
    const symbol = q.get('symbol')
    if (symbol) {
      const report = await getIntelReport(symbol)
      if (!report) return apiError(`No intel for '${symbol}'`, 404)
      return apiSuccess(report)
    }
    const top = Math.min(50, Math.max(1, Number(q.get('top') ?? 20)))
    const items = await getTopIntel(top)
    return apiSuccess({ count: items.length, items })
  } catch (error) {
    return apiError((error as Error).message, 500)
  }
}
