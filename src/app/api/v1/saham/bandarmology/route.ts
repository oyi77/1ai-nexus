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
import { verifyToken } from '@/lib/jwt'
import { awardXp } from '@/lib/gamification'
import {
  getBrokerBoard,
  getForeignLeaders,
  getForeignSeries,
  getForeignStreaks,
  getMarketFlow,
  getSectorRotation,
} from '@/lib/modules/market/provider/idx-bandarmology'

export const dynamic = 'force-dynamic'

/** Resolve the authenticated user id for a public GET (XP award only when present). */
async function getOptionalUserId(request: NextRequest): Promise<string | null> {
  let token: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = request.cookies.get('nexus-session')?.value
  }
  if (!token) return null
  const payload = await verifyToken(token)
  return payload?.userId ?? null
}

/** Fire-and-forget RUN_SCAN award (idempotent per day so it cannot be spammed). */
function rewardScan(userId: string | null): void {
  if (!userId) return
  const day = new Date().toISOString().slice(0, 10)
  void awardXp(userId, 'RUN_SCAN', `scan:${day}`).catch((err) => {
    console.error('RUN_SCAN XP award error:', err)
  })
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const view = p.get('view') ?? 'leaders'
  const limit = Math.min(Number(p.get('limit') ?? 20), 100)

  try {
    const userId = await getOptionalUserId(request)
    switch (view) {
      case 'leaders': {
        const data = await getForeignLeaders(limit)
        rewardScan(userId)
        return apiSuccess(data)
      }
      case 'streaks': {
        const data = await getForeignStreaks(Math.max(2, Number(p.get('minDays') ?? 3)), limit)
        rewardScan(userId)
        return apiSuccess(data)
      }
      case 'brokers': {
        const data = await getBrokerBoard(limit)
        rewardScan(userId)
        return apiSuccess(data)
      }
      case 'rotation': {
        const data = await getSectorRotation()
        rewardScan(userId)
        return apiSuccess(data)
      }
      case 'flow': {
        const data = await getMarketFlow()
        rewardScan(userId)
        return apiSuccess(data)
      }
      case 'series': {
        const symbol = p.get('symbol')
        if (!symbol) return apiError('symbol is required for view=series', 400)
        const data = await getForeignSeries(symbol, Math.min(Number(p.get('days') ?? 30), 90))
        if (!data) return apiError(`No foreign-flow history for '${symbol}'`, 404)
        rewardScan(userId)
        return apiSuccess(data)
      }
      default:
        return apiError(`Unknown view '${view}'. Available: leaders, streaks, series, brokers, rotation, flow`, 400)
    }
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
