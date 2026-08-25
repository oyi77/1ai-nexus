// ─────────────────────────────────────────────────────────────
// GET /api/v1/crypto/top-symbols — live top-N USDT-perp bases by
// quote volume (drives orderbook/trades/liquidations tabs).
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { fetchTopCryptoSymbols } from '@/lib/modules/market/provider/binance-top'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const n = Math.min(Math.max(Number(request.nextUrl.searchParams.get('n') ?? 9), 1), 25)
  try {
    const symbols = await fetchTopCryptoSymbols(n)
    return apiSuccess({ symbols: symbols.map((s) => s.symbol), detail: symbols })
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
