// ─────────────────────────────────────────────────────────────
// GET /api/v1/equities/universe
//   ?market=<id>  → full listed-equity universe for a global market
//                   (us, japan, uk, germany, hongkong, india, canada,
//                    korea, taiwan, australia, singapore, brazil,
//                    switzerland, netherlands)
//   ?markets=1    → market catalog
//   ?group=<id>   → peer group symbols. Curated groups come from
//                   config; idx-* groups are DERIVED live from the
//                   universe via sector/industry predicates.
//   ?sector=<s>   → raw IDX universe rows filtered by sector.
//   ?quotes=1     → embed latest harvested session OHLCV per IDX stock
//                   (from data/idx/saham-latest.json when present).
//   (default)     → dynamic IDX listed-equity universe.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { IDX_DERIVED_GROUPS, PEER_GROUPS } from '@/lib/config/universe'
import { getIdxUniverse } from '@/lib/modules/market/provider/idx-universe'
import { getSahamLatestQuotes } from '@/lib/modules/market/provider/idx-saham-quotes'
import {
  getGlobalMarketCatalog,
  getGlobalUniverse,
} from '@/lib/modules/market/provider/global-universe'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  // Global markets first — they own their own namespace.
  if (params.get('markets')) {
    return apiSuccess({ markets: getGlobalMarketCatalog() })
  }

  const marketId = params.get('market')
  if (marketId) {
    try {
      const universe = await getGlobalUniverse(marketId)
      return apiSuccess(universe)
    } catch (error) {
      return apiError((error as Error).message, 400)
    }
  }

  const groupId = params.get('group')
  const sector = params.get('sector')

  try {
    if (groupId) {
      // Derived groups: membership computed from the live universe.
      const derived = IDX_DERIVED_GROUPS[groupId]
      if (derived) {
        const { stocks, meta } = await getIdxUniverse()
        const industryRe = derived.industry ? new RegExp(derived.industry, 'i') : null
        const symbols = stocks
          .filter((s) => s.sector === derived.sector && (!industryRe || industryRe.test(s.industry ?? '')))
          .map((s) => s.symbol)
        return apiSuccess({ group: { id: groupId, name: derived.name, symbols, derived: true }, meta })
      }

      const group = PEER_GROUPS[groupId]
      if (!group) {
        return apiError(
          `Unknown peer group '${groupId}'. Available: ${[...Object.keys(PEER_GROUPS), ...Object.keys(IDX_DERIVED_GROUPS)].join(', ')}`,
          400,
        )
      }
      return apiSuccess({ group: { id: groupId, ...group, derived: false } })
    }

    const { stocks, meta } = await getIdxUniverse()

    if (sector) {
      const filtered = stocks.filter((s) => s.sector?.toLowerCase() === sector.toLowerCase())
      return apiSuccess({ exchange: 'IDX', sector, stocks: filtered, meta })
    }

    // Optional instant-quote layer from the daily harvest snapshot.
    if (params.get('quotes')) {
      try {
        const q = await getSahamLatestQuotes()
        return apiSuccess({
          exchange: 'IDX',
          stocks: stocks.map((s) => ({ ...s, quote: q.quotes[s.symbol] ?? null })),
          meta: { ...meta, quoteTradeDate: q.tradeDate },
        })
      } catch { /* snapshot absent — fall through to plain payload */ }
    }

    return apiSuccess({ exchange: 'IDX', stocks, meta })
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
