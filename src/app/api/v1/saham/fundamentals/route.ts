// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/fundamentals — IDX fundamental ratios from
// the nightly TradingView harvest snapshot.
//   (default)      whole-universe map + capturedAt meta
//   ?symbol=BBCA   single stock ('BBCA.JK' also accepted)
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getFundamentals, getFundamentalsSnapshot } from '@/lib/modules/market/provider/idx-fundamentals'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol')
  try {
    if (!symbol) return apiSuccess(await getFundamentalsSnapshot())
    const row = await getFundamentals(symbol)
    if (!row) return apiError(`No fundamentals for '${symbol}' in the latest harvest`, 404)
    return apiSuccess({ symbol: symbol.toUpperCase(), ...row })
  } catch (error) {
    return apiError((error as Error).message, 500)
  }
}
