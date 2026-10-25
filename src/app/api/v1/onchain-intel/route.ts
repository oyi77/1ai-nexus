import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchMempoolEvents, persistMempoolEvents } from "@/lib/modules/chain/mempool/intel";
import { fetchBridgeStats, fetchBridgeFlows, persistBridgeFlows } from "@/lib/modules/chain/bridge/flows";
import { fetchStakingQueue, persistStakingFlow } from "@/lib/modules/chain/ethereum/staking-queue";
import { cacheGet, cacheSet } from "@/lib/cache"

export const dynamic = "force-dynamic";
type SourceResult<T> = { data: T | null; status: 'live' | 'stale' | 'unavailable' }


export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    const selected = (name: string) => action === name || action === 'all'
    const load = async <T>(key: string, fetcher: () => Promise<T>): Promise<SourceResult<T>> => {
      const cached = await cacheGet<T>(`onchain:${key}`).catch(() => null)
      try {
        const data = await fetcher()
        cacheSet(`onchain:${key}`, data, 60).catch(() => {})
        return { data, status: 'live' as const }
      } catch {
        return cached === null
          ? { data: null, status: 'unavailable' as const }
          : { data: cached, status: 'stale' as const }
      }
    }
    const [mempool, bridge, staking] = await Promise.all([
      selected('mempool') ? load('mempool', async () => {
        const events = await fetchMempoolEvents()
        if (events.length > 0) persistMempoolEvents(events).catch(() => {})
        return events
      }) : null,
      selected('bridge') ? Promise.all([
        load('bridge', fetchBridgeStats),
        load('bridge-flows', async () => {
          const flows = await fetchBridgeFlows()
          if (flows.length > 0) persistBridgeFlows(flows).catch(() => {})
          return flows
        }),
      ]) : null,
      selected('staking') ? load('staking', async () => {
        const snapshot = await fetchStakingQueue()
        persistStakingFlow(snapshot).catch(() => {})
        return snapshot
      }) : null,
    ])
    const data: Record<string, unknown> = { sources: {} }
    const results: Record<string, SourceResult<unknown> | null> = { mempool, staking }
    if (bridge) {
      results.bridge = bridge[0]
      results.bridgeFlows = bridge[1]
    }
    for (const [key, result] of Object.entries(results)) {
      if (!result) continue
      data[key] = result.data
      ;(data.sources as Record<string, string>)[key] = result.status
    }
    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/onchain-intel error:", error);
    return apiError("Failed to fetch on-chain intelligence", 502);
  }
}
