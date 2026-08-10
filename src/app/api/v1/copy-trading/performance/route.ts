import { apiJson, cacheHeaders } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'
import gateioModule, { type GateioPerformanceData } from '@/lib/modules/derivatives/gateio/performance'

/**
 * GET /api/v1/copy-trading/performance?leader_id=30809&platform=gateio
 *
 * Per-leader copy-trading performance intelligence: profit curve, position
 * concentration, recent trades, and full risk/stat profile.
 *
 * Per-section resilience: the module fetches each section independently with
 * its own cache key — a partial upstream failure leaves that section empty
 * (or a stale cached value) instead of failing the whole request. The route
 * only serves the explicit fallback shape when the module itself throws.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const platform = (searchParams.get('platform') ?? 'gateio').toLowerCase()
  if (platform !== 'gateio') {
    return apiJson({ error: `Unsupported platform: ${platform}` }, { status: 400 })
  }

  const leaderIdRaw = searchParams.get('leader_id') ?? searchParams.get('leaderId')
  if (!leaderIdRaw) {
    return apiJson({ error: 'leader_id is required' }, { status: 400 })
  }
  const leaderId = Number(leaderIdRaw)
  if (!Number.isFinite(leaderId) || leaderId <= 0) {
    return apiJson({ error: `Invalid leader_id: ${leaderIdRaw}` }, { status: 400 })
  }

  const key = `copy-trading:performance:${platform}:${leaderId}`

  try {
    const { data, fromCache } = await getCached<GateioPerformanceData>(
      key,
      60_000,
      () => gateioModule.fetch<GateioPerformanceData>({ leaderId }).then((r) => r.data),
    )
    const resp = apiJson({ ...data, fetchedAt: Date.now() })
    cacheHeaders(resp, 60)
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch {
    // Hard failure (not per-section): serve the explicit fallback shape,
    // never a 502.
    const fallback = await gateioModule.fallbackFn?.<GateioPerformanceData>({ leaderId })
    const data: GateioPerformanceData = fallback?.data ?? { profile: null, equity: [], markets: [], trades: [] }
    const resp = apiJson({ ...data, fetchedAt: Date.now(), degraded: true })
    cacheHeaders(resp, 30)
    resp.headers.set('X-Cache', 'FALLBACK')
    return resp
  }
}