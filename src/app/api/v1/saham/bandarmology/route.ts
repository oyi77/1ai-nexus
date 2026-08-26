// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/bandarmology — IDX foreign-flow analytics
//   ?view=leaders (default)  top foreign net buy/sell today
//   ?view=streaks            accumulation/distribution streaks
//   ?view=series&symbol=BBRI foreign-net daily series (+cum)
//   ?view=brokers            market broker board by turnover
//   ?view=rotation           sector-level foreign-flow rollup
//   ?view=flow               market-wide daily flow timeline
// Params: ?limit=&minDays=&days=
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  getBrokerBoard,
  getForeignLeaders,
  getForeignSeries,
  getForeignStreaks,
  getMarketFlow,
  getSectorRotation,
} from '@/lib/modules/market/provider/idx-bandarmology'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const view = p.get('view') ?? 'leaders'
  const limit = Math.min(Number(p.get('limit') ?? 20), 100)

  try {
    switch (view) {
      case 'leaders':
        return apiSuccess(await getForeignLeaders(limit))
      case 'streaks':
        return apiSuccess(await getForeignStreaks(Math.max(2, Number(p.get('minDays') ?? 3)), limit))
      case 'brokers':
        return apiSuccess(await getBrokerBoard(limit))
      case 'rotation':
        return apiSuccess(await getSectorRotation())
      case 'flow':
        return apiSuccess(await getMarketFlow())
      case 'series': {
        const symbol = p.get('symbol')
        if (!symbol) return apiError('symbol is required for view=series', 400)
        const data = await getForeignSeries(symbol, Math.min(Number(p.get('days') ?? 30), 90))
        if (!data) return apiError(`No foreign-flow history for '${symbol}'`, 404)
        return apiSuccess(data)
      }
      default:
        return apiError(`Unknown view '${view}'. Available: leaders, streaks, series, brokers, rotation, flow`, 400)
    }
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
