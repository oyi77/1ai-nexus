// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/dual — US-IDX dual-listed quotes.
//   (default)      all known pairs
//   ?symbol=TLKM   single pair (IDX close + US price, informational)
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getDualQuote, listDuals } from '@/lib/modules/market/provider/idx-dual'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol')
  try {
    if (symbol) {
      const row = await getDualQuote(symbol)
      if (!row) return apiError(`No dual listing for '${symbol}'`, 404)
      return apiSuccess(row)
    }
    return apiSuccess({ count: listDuals().length, pairs: listDuals() })
  } catch (error) {
    return apiError((error as Error).message, 500)
  }
}
