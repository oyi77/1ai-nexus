// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/realtime?symbol=BBCA[,.TLKM] — realtime-ish
// IDX quotes. Source ladder:
//   1. iTick (ONLY when ITICK_API_KEY set — its free tier excludes IDX,
//      so absent by default)
//   2. Stockbit RE (free, keyless, embedded RSC quotes) ← default
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getRealtimeQuote as getItickQuote, isRealtimeEnabled } from '@/lib/modules/market/provider/itick-realtime'
import { getStockbitQuote } from '@/lib/modules/market/provider/stockbit-realtime'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get('symbol') ?? ''
  const symbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25)
  if (symbols.length === 0) return apiError('symbol query param required, e.g. ?symbol=BBCA or ?symbol=BBCA,TLKM', 400)

  const quotes = await Promise.allSettled(
    symbols.map(async (raw) => {
      const code = raw.replace('.JK', '').toUpperCase()
      if (isRealtimeEnabled()) {
        const itick = await getItickQuote(code)
        if (itick.quote) return { ...itick.quote, symbol: `${code}.JK` }
      }
      const sb = await getStockbitQuote(code)
      return {
        symbol: sb.symbol,
        source: 'stockbit-re' as const,
        price: sb.price,
        previous: sb.previous,
        changePct: sb.changePct,
        volume: sb.volume ?? undefined,
        bid: sb.bid,
        ask: sb.ask,
        sector: sb.sector,
        subSector: sb.subSector,
        marketStatus: sb.marketStatus,
        updatedAt: sb.updatedAt,
        sessionTime: sb.sessionTime,
      }
    }),
  )

  const data = quotes.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { symbol: `${symbols[i].replace('.JK', '').toUpperCase()}.JK`, error: String(r.reason).slice(0, 140) },
  )
  return apiSuccess({ quotes: data, source: isRealtimeEnabled() ? 'itick-or-stockbit' : 'stockbit-re' })
}
