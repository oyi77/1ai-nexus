import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  getScreenerSnapshot,
  getScreenerStock,
  getTopMovers,
} from '@/lib/modules/market/provider/idx-screener'

export const dynamic = 'force-dynamic'

// ─── GET /api/v1/saham/screener ────────────────────────────
//   (default)      whole universe + capturedAt meta
//   ?symbol=BBCA   single stock (25 fields)
//   ?top=gainers|losers&limit=20  top movers by chg1d
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol')
  const top = request.nextUrl.searchParams.get('top')
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 20)))

  try {
    if (symbol) {
      const row = await getScreenerStock(symbol)
      if (!row) return apiError(`No screener data for '${symbol}'`, 404)
      return apiSuccess({ ...row, symbol: symbol.toUpperCase() })
    }

    if (top === 'gainers' || top === 'losers') {
      const items = await getTopMovers(limit, top)
      return apiSuccess({ top, count: items.length, items })
    }

    const snap = await getScreenerSnapshot()
    return apiSuccess(snap)
  } catch (error) {
    return apiError((error as Error).message, 500)
  }
}