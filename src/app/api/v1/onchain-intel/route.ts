// ─────────────────────────────────────────────────────────────
// GET /api/v1/onchain-intel — Mempool + Bridge + Staking Intelligence
// Zero API keys — all public endpoints
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchMempoolEvents } from "@/lib/modules/chain/mempool-intel";
import { fetchBridgeStats } from "@/lib/modules/chain/bridge-flow";
import { fetchStakingQueue, persistStakingFlow } from "@/lib/modules/chain/staking-queue";

export const dynamic = "force-dynamic";

let cachedMempool: unknown = null;
let cachedBridge: unknown = null;
let cachedStaking: Awaited<ReturnType<typeof fetchStakingQueue>> | null = null;
let cacheTs = 0;
const CACHE_TTL = 60 * 1000; // 1 minute for mempool, longer for others

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    const now = Date.now();

    if (action === "mempool" || action === "all") {
      if (!cachedMempool || now - cacheTs > CACHE_TTL) {
        cachedMempool = await fetchMempoolEvents();
      }
    }

    if (action === "bridge" || action === "all") {
      if (!cachedBridge || now - cacheTs > CACHE_TTL * 5) {
        cachedBridge = await fetchBridgeStats();
      }
    }

    if (action === "staking" || action === "all") {
      if (!cachedStaking || now - cacheTs > CACHE_TTL * 5) {
        cachedStaking = await fetchStakingQueue();
        persistStakingFlow(cachedStaking).catch(() => {})
      }
    }

    cacheTs = now;

    const data = action === "mempool"
      ? { mempool: cachedMempool }
      : action === "bridge"
      ? { bridge: cachedBridge }
      : action === "staking"
      ? { staking: cachedStaking }
      : { mempool: cachedMempool, bridge: cachedBridge, staking: cachedStaking };

    return cacheHeaders(apiSuccess(data), 60);
  } catch (error) {
    console.error("GET /api/v1/onchain-intel error:", error);
    return apiError("Failed to fetch on-chain intelligence", 502);
  }
}
