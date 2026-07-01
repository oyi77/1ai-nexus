import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchMempoolEvents, persistMempoolEvents } from "@/lib/modules/chain/mempool-intel";
import { fetchBridgeStats, persistBridgeFlows } from "@/lib/modules/chain/bridge-flow";
import { fetchStakingQueue, persistStakingFlow } from "@/lib/modules/chain/staking-queue";
import { cacheGet } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    let mempool = await cacheGet<Awaited<ReturnType<typeof fetchMempoolEvents>>>('onchain:mempool')
    let bridge = await cacheGet<Awaited<ReturnType<typeof fetchBridgeStats>>>('onchain:bridge')
    let staking = await cacheGet<Awaited<ReturnType<typeof fetchStakingQueue>>>('onchain:staking')
    if (!mempool) mempool = await fetchMempoolEvents()
    if (!bridge) bridge = await fetchBridgeStats()
    if (!staking) staking = await fetchStakingQueue()

    // Persist to DB for backtesting (fire-and-forget)
    if (mempool?.length > 0) persistMempoolEvents(mempool).catch(() => {})
    if (bridge?.bridges?.length > 0) persistBridgeFlows([]).catch(() => {})
    if (staking) persistStakingFlow(staking).catch(() => {})

    const data: Record<string, unknown> = {}
    if (action === "mempool" || action === "all") data.mempool = mempool
    if (action === "bridge" || action === "all") data.bridge = bridge
    if (action === "staking" || action === "all") data.staking = staking
    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/onchain-intel error:", error);
    return apiError("Failed to fetch on-chain intelligence", 502);
  }
}
