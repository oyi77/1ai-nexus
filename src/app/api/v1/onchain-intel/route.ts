// ─────────────────────────────────────────────────────────────
// GET /api/v1/onchain-intel — Mempool + Bridge + Staking Intelligence
// Reads from sharedCache (background-refreshed), falls back to live fetch
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchMempoolEvents } from "@/lib/modules/chain/mempool-intel";
import { fetchBridgeStats } from "@/lib/modules/chain/bridge-flow";
import { fetchStakingQueue } from "@/lib/modules/chain/staking-queue";
import { sharedCache } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";

    let mempool = sharedCache.get<Awaited<ReturnType<typeof fetchMempoolEvents>>>('onchain:mempool')
    let bridge = sharedCache.get<Awaited<ReturnType<typeof fetchBridgeStats>>>('onchain:bridge')
    let staking = sharedCache.get<Awaited<ReturnType<typeof fetchStakingQueue>>>('onchain:staking')

    if (!mempool) mempool = await fetchMempoolEvents()
    if (!bridge) bridge = await fetchBridgeStats()
    if (!staking) staking = await fetchStakingQueue()

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
