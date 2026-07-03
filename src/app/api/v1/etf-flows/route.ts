import { fetchGraceful } from '@/lib/api/fetch-utils'
import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchETFSummary, persistETFFlows } from "@/lib/modules/tradfi/etf/flows";
import { fetchPremiumSnapshots, persistPremiumSnapshots } from "@/lib/modules/tradfi/premium/monitor";
import { cacheGet } from "@/lib/cache"

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    let etf = await cacheGet<Awaited<ReturnType<typeof fetchETFSummary>>>('etf:summary')
    let premiums = await cacheGet<Awaited<ReturnType<typeof fetchPremiumSnapshots>>>('etf:premiums')
    if (!etf) etf = await fetchETFSummary()
    if (!premiums) premiums = await fetchPremiumSnapshots()

    // Persist to DB for backtesting (fire-and-forget)
    if (etf?.flows?.length > 0) persistETFFlows(etf.flows).catch(() => {})
    if (premiums?.length > 0) persistPremiumSnapshots(premiums).catch(() => {})

    const data: Record<string, unknown> = {}
    if (action === "etf" || action === "all") data.etf = etf
    if (action === "premiums" || action === "all") data.premiums = premiums
    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/etf-flows error:", error);
    return apiError("Failed to fetch ETF flow data", 502);
  }
}
