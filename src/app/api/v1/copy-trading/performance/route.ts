import { apiJson, cacheHeaders } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'
import type { GateioPerformanceData } from '@/lib/modules/derivatives/gateio/performance'
import {
  getEnabledPlatforms,
  getPerformanceModule,
  isPlatformEnabled,
} from '@/lib/modules/market/copy-trading/registry'
import type { CopyTradingPlatform } from '@/lib/modules/market/copy-trading/types'

/**
 * GET /api/v1/copy-trading/performance?leader_id=30809&platform=gateio
 *
 * Per-leader copy-trading performance intelligence: profit curve, position
 * concentration, recent trades, and full risk/stat profile.
 *
 * Platform dispatch is registry-driven: only platforms with a registered
 * performance module are accepted (today: gateio). Unsupported platforms
 * get a 400 listing the supported set.
 *
 * Per-section resilience: the module fetches each section independently with
 * its own cache key — a partial upstream failure leaves that section empty
 * (or a stale cached value) instead of failing the whole request. The route
 * only serves the explicit fallback shape when the module itself throws.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const platform = (searchParams.get('platform') ?? 'gateio').toLowerCase() as CopyTradingPlatform

  const performanceModule = getPerformanceModule(platform)
  if (!isPlatformEnabled(platform) || !performanceModule) {
    const supported = getEnabledPlatforms().filter((p) => getPerformanceModule(p))
    return apiJson(
      { error: `Unsupported platform: ${platform}. Supported platforms: ${supported.join(', ') || 'none'}` },
      { status: 400 },
    )
  }

  const leaderIdRaw = searchParams.get('leader_id') ?? searchParams.get('leaderId')
  if (!leaderIdRaw) {
    return apiJson({ error: 'leader_id is required' }, { status: 400 })
  }
  // Binance portfolio IDs are 19-digit integers that exceed Number.MAX_SAFE_INTEGER
  // (2^53 ≈ 9.0e15) — Number('5142214769055593984') silently corrupts to
  // 5142214769055594000, so the module queries a non-existent portfolio: the
  // friendly/ endpoints (profile/positions/status) fail while the public
  // chart/coin endpoints still return data. Never round-trip the id through a JS
  // Number; keep the exact digit string and pass it through to the module.
  const leaderId = leaderIdRaw.replace(/^0+(?=\d)/, '')
  if (!/^\d+$/.test(leaderId) || Number(leaderId) <= 0) {
    return apiJson({ error: `Invalid leader_id: ${leaderIdRaw}` }, { status: 400 })
  }

  const key = `copy-trading:performance:${platform}:${leaderId}`

  try {
    const { data, fromCache } = await getCached<GateioPerformanceData>(
      key,
      60_000,
      () => performanceModule.fetch<GateioPerformanceData>({ leaderId }).then((r) => r.data),
    )
    const resp = apiJson({ ...data, fetchedAt: Date.now() })
    cacheHeaders(resp, 60)
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch {
    // Hard failure (not per-section): serve the explicit fallback shape,
    // never a 502.
    const fallback = await performanceModule.fallbackFn?.<GateioPerformanceData>({ leaderId })
    const data: GateioPerformanceData = fallback?.data ?? { profile: null, equity: [], markets: [], trades: [] }
    const resp = apiJson({ ...data, fetchedAt: Date.now(), degraded: true })
    cacheHeaders(resp, 30)
    resp.headers.set('X-Cache', 'FALLBACK')
    return resp
  }
}
