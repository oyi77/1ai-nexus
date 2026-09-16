// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/ajaib — Ajaib market data (no auth).
//   (default)      IDX whole-universe snapshot + capturedAt meta (DB-first)
//   ?symbol=BBRI   IDX analyst consensus + PE/PBV bands + technicals
//   ?market=us     US stocks universe, live-only (adds day momentum)
//   ?market=mf     reksa-dana universe, live-only (AUM, returns, drawdown)
//   ?market=crypto crypto list, live-only (price + 24h %)
//   ?market=indices[&index=IDX30]  IDX index membership map, live-only
// NOTE: per-symbol analysis is populated for IDX STOCK only
// (US/MF codes 404 here). Non-IDX markets are live-only (cached,
// no DB tables) — IDX stays DB-first via the nightly harvest.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getAjaibAnalysis, normalizeCode } from '@/lib/modules/market/provider/idx-ajaib/analysis'
import {
  getAjaibUniverse,
  getAjaibUS,
  getAjaibMF,
  getAjaibCrypto,
  EmptySnapshotError,
} from '@/lib/modules/market/provider/idx-ajaib/universe'
import { getIndexMembership } from '@/lib/modules/market/provider/idx-ajaib/indices'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const symbol = q.get('symbol')
  const market = q.get('market')
  try {
    if (symbol) {
      const row = await getAjaibAnalysis(symbol)
      if (!row) return apiError(`No Ajaib analysis for '${symbol}' (IDX STOCK only)`, 404)
      return apiSuccess({ symbol: normalizeCode(symbol), ...row })
    }
    if (market === 'us') return apiSuccess(await getAjaibUS())
    if (market === 'mf') return apiSuccess(await getAjaibMF())
    if (market === 'crypto') return apiSuccess(await getAjaibCrypto())
    if (market === 'indices') {
      const index = q.get('index')
      const map = await getIndexMembership()
      if (index) {
        const codes = map.indices[index.toUpperCase()]
        if (!codes) return apiError(`Unknown index '${index}'`, 404)
        return apiSuccess({ index: index.toUpperCase(), count: codes.length, codes })
      }
      return apiSuccess(map)
    }
    return apiSuccess(await getAjaibUniverse())
  } catch (error) {
    if (error instanceof EmptySnapshotError) {
      return apiError('No Ajaib snapshot yet — run npm run harvest:idx-ajaib (weekdays 19:05 cron)', 503)
    }
    return apiError((error as Error).message, 500)
  }
}
