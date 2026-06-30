// ─────────────────────────────────────────────────────────────
// GET /api/v1/etf-flows — ETF Flow Intelligence + Premium Monitor
// Reads from sharedCache (background-refreshed), falls back to live fetch
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchETFSummary } from "@/lib/modules/tradfi/etf-flow";
import { fetchPremiumSnapshots } from "@/lib/modules/tradfi/premium-monitor";
import { sharedCache } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";

    let etf = sharedCache.get<Awaited<ReturnType<typeof fetchETFSummary>>>('etf:summary')
    let premiums = sharedCache.get<Awaited<ReturnType<typeof fetchPremiumSnapshots>>>('etf:premiums')

    if (!etf) etf = await fetchETFSummary()
    if (!premiums) premiums = await fetchPremiumSnapshots()

    const data: Record<string, unknown> = {}
    if (action === "etf" || action === "all") data.etf = etf
    if (action === "premiums" || action === "all") data.premiums = premiums

    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/etf-flows error:", error);
    return apiError("Failed to fetch ETF flow data", 502);
  }
}
