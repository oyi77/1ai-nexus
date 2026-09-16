// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/signals — RS-check, breakout, bandar-flow signals
// composed from nightly harvest snapshots (no auth, no upstream).
//   ?view=rs (default)      relative strength vs universe median
//   ?view=breakout           within X% below 52w high (&within=5)
//   ?view=bandar             bandar accumulation × foreign streak
//   ?view=sectors            sector money flow (bandar top-1 by sector)
//   ?view=sectormatrix       sector x bandar matrix (foreign + accdist)
//   ?view=backtest&lane=rs   lane backtest (rs|breakout|ara), 5-session horizon
// Params: ?limit=20 (1-100).
// Empty DB → 503 with staging instructions.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  getRSSignals,
  getBreakoutSignals,
  getARAProximity,
  getBandarFlowSignals,
  getSectorFlow,
  getSectorBandarMatrix,
  backtestSignals,
} from '@/lib/modules/market/provider/idx-signals'
import { EmptySnapshotError } from '@/lib/modules/market/provider/idx-stockbit'

const NO_DATA = 'No IDX snapshot yet — run the nightly harvests (npm run harvest:idx-screener)'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const view = q.get('view') ?? 'rs'
  const limitRaw = Number(q.get('limit') ?? 20)
  const limit = Math.min(1000, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20))
  try {
    if (view === 'breakout') {
      const withinRaw = Number(q.get('within') ?? 5)
      const within = Math.min(30, Math.max(0.5, Number.isFinite(withinRaw) ? withinRaw : 5))
      return apiSuccess({ view, ...(await getBreakoutSignals(within, limit)) })
    }
    if (view === 'ara') {
      const ara = await getARAProximity(limit)
      return apiSuccess({ view, ...ara })
    }
    if (view === 'sectors') {
      return apiSuccess({ view, ...(await getSectorFlow()) })
    }
    if (view === 'bandar') {
      return apiSuccess({ view, ...(await getBandarFlowSignals(limit)) })
    }
    if (view === 'sectormatrix') {
      return apiSuccess({ view, ...(await getSectorBandarMatrix()) })
    }
    if (view === 'backtest') {
      const laneRaw = q.get('lane') ?? 'breakout'
      const lane = laneRaw === 'rs' || laneRaw === 'ara' ? laneRaw : 'breakout'
      return apiSuccess({ view, lane, ...(await backtestSignals(lane, 10, 5)) })
    }
    return apiSuccess({ view: 'rs', ...(await getRSSignals(limit)) })
  } catch (error) {
    if (error instanceof EmptySnapshotError) return apiError(NO_DATA, 503)
    return apiError((error as Error).message, 500)
  }
}
