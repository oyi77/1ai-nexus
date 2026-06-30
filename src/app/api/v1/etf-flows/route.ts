// ─────────────────────────────────────────────────────────────
// GET /api/v1/etf-flows — ETF Flow Intelligence + Premium Monitor
// Spot BTC/ETH ETF flows + Coinbase/Korea premiums + futures basis
// Zero API keys — all public endpoints
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchETFSummary, persistETFFlows } from "@/lib/modules/tradfi/etf-flow";
import { fetchPremiumSnapshots, persistPremiumSnapshots } from "@/lib/modules/tradfi/premium-monitor";

export const dynamic = "force-dynamic";

let cachedETF: Awaited<ReturnType<typeof fetchETFSummary>> | null = null;
let cachedPremiums: Awaited<ReturnType<typeof fetchPremiumSnapshots>> | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    const now = Date.now();

    if (action === "etf" || action === "all") {
      if (!cachedETF || now - cacheTs > CACHE_TTL) {
        cachedETF = await fetchETFSummary();
        persistETFFlows(cachedETF.flows).catch(() => {})
        cacheTs = now;
      }
    }

    if (action === "premiums" || action === "all") {
      if (!cachedPremiums || now - cacheTs > CACHE_TTL) {
        cachedPremiums = await fetchPremiumSnapshots();
        persistPremiumSnapshots(cachedPremiums).catch(() => {})
      }
    }

    const data = action === "etf"
      ? { etf: cachedETF }
      : action === "premiums"
      ? { premiums: cachedPremiums }
      : { etf: cachedETF, premiums: cachedPremiums };

    return cacheHeaders(apiSuccess(data), 300);
  } catch (error) {
    console.error("GET /api/v1/etf-flows error:", error);
    return apiError("Failed to fetch ETF flow data", 502);
  }
}
