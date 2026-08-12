import { apiJson, cacheHeaders } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'
import { findLeaderById } from '@/lib/modules/market/okx-copy/leaderboard'
import { findHyperliquidLeaderById } from '@/lib/modules/market/hyperliquid-copy/leaderboard'
import { findBitgetLeaderById } from '@/lib/modules/market/bitget-copy/leaderboard'
import { getEnabledPlatforms, isPlatformEnabled } from '@/lib/modules/market/copy-trading/registry'
import type { CopyTradingPlatform } from '@/lib/modules/market/copy-trading/types'

export const dynamic = 'force-dynamic'

/**
 * Deep per-leader lookups paginate every page/row server-side, which is too
 * expensive to repeat on every hit — cache the RESULT for one hour. This is
 * deliberately independent of the registry's 180s list TTL.
 */
const LEADER_LOOKUP_TTL_MS = 3_600_000

/**
 * GET /api/v1/copy-trading/leader?platform={okx|hyperliquid|bitget}&leader_id={id}&cycle=month
 *
 * Deep per-leader lookup, served through a server boundary.
 *
 * Each platform's leaderboard list is only partially fetchable from the
 * client — the OKX follow-rank endpoint caps its page size at 20 rows, the
 * Hyperliquid stats-data dump has ~41k rows, and Bitget returns at most ~20
 * rows per traderView page — so searching the page-1 list misses any leader
 * ranked deeper. The platform find* helpers scan every page/row server-side
 * and return the matching leader with its platform extras (OKX lever, tier,
 * profitShare, equityCurve, positions; Hyperliquid windowPerformances; Bitget
 * copierProfit, score, portfolioId, equityCurve).
 *
 * These modules are server-only (node `crypto` + cached redis fetcher), so the
 * client page must never import them — this route is the boundary.
 */
export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const platform = (searchParams.get('platform') ?? 'gateio').toLowerCase() as CopyTradingPlatform
  const cycle = searchParams.get('cycle') ?? 'month'

  if (!isPlatformEnabled(platform)) {
    const supported = getEnabledPlatforms().join(', ')
    return apiJson(null, {
      error: `Unsupported platform: ${platform}. Supported: ${supported || 'none'}`,
      status: 400,
    })
  }
  if (platform !== 'okx' && platform !== 'hyperliquid' && platform !== 'bitget') {
    // Other platforms keep the leaderboard-search path (or have a performance module).
    return apiJson(null, { error: `Per-leader lookup not available for platform: ${platform}`, status: 400 })
  }

  const leaderId = searchParams.get('leader_id') ?? searchParams.get('leaderId')
  if (!leaderId) {
    return apiJson(null, { error: 'leader_id is required', status: 400 })
  }

  const ttlMs = LEADER_LOOKUP_TTL_MS
  const key = `copy-trading:leader:${platform}:${leaderId}:${cycle}`

  let leader: unknown = null
  let degraded = false
  try {
    const { data, fromCache } = await getCached(key, ttlMs, async () => {
      const found =
        platform === 'hyperliquid'
          ? await findHyperliquidLeaderById(leaderId, cycle)
          : platform === 'bitget'
            ? await findBitgetLeaderById(leaderId, cycle)
            : await findLeaderById(leaderId, cycle)
      return { leader: found }
    })
    leader = data.leader
    const resp = apiJson({ leader, degraded: false })
    cacheHeaders(resp, Math.floor(ttlMs / 1000))
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch {
    // Upstream unreachable and no cached copy — surface degraded instead of a 500.
    degraded = true
  }

  const resp = apiJson({ leader, degraded })
  cacheHeaders(resp, 30)
  resp.headers.set('X-Cache', 'ERROR')
  return resp
}
