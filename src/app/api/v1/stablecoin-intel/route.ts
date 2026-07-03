export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import {
  fetchStablecoinIntel,
  persistStablecoinSnapshot,
  getStablecoinHistory,
  type StablecoinIntelResult,
} from "@/lib/modules/chain/stablecoin-intel";
import { cacheGet, cacheSet } from "@/lib/cache"

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";

    if (action === "history") {
      const coin = request.nextUrl.searchParams.get("coin") ?? "TOTAL";
      const hours = parseInt(request.nextUrl.searchParams.get("hours") ?? "168", 10);
      const history = await getStablecoinHistory(coin, hours);
      return cacheHeaders(apiSuccess({ history }), 60);
    }

    // Fetch fresh or cached intel
    let intel = await cacheGet<StablecoinIntelResult>("stablecoin:intel");
    if (!intel) {
      intel = await fetchStablecoinIntel();
      await cacheSet("stablecoin:intel", intel, 120); // 2 min cache
    }

    // Fire-and-forget persist for historical tracking
    persistStablecoinSnapshot(intel).catch(() => {});

    const data: Record<string, unknown> = {};
    if (action === "intel" || action === "all") data.intel = intel;
    if (action === "history" || action === "all") {
      const history = await getStablecoinHistory("TOTAL", 168);
      data.history = history;
    }

    return cacheHeaders(apiSuccess(data), 60);
  } catch (error) {
    console.error("GET /api/v1/stablecoin-intel error:", error);
    return apiError("Failed to fetch stablecoin intelligence", 502);
  }
}
