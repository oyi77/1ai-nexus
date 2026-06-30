// ─────────────────────────────────────────────────────────────
// GET /api/v1/risk-intel — Credit Risk + Miner Flow + Narrative
// Reads from sharedCache (background-refreshed), falls back to live fetch
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchCreditRisk } from "@/lib/modules/defi/credit-risk";
import { fetchMinerFlow } from "@/lib/modules/chain/miner-flow";
import { fetchNarrativeRotation } from "@/lib/modules/derived/narrative-rotation";
import { sharedCache } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";

    let creditRisk = sharedCache.get<Awaited<ReturnType<typeof fetchCreditRisk>>>('risk:credit')
    let minerFlow = sharedCache.get<Awaited<ReturnType<typeof fetchMinerFlow>>>('risk:miner')
    let narrative = sharedCache.get<Awaited<ReturnType<typeof fetchNarrativeRotation>>>('risk:narrative')

    if (!creditRisk) creditRisk = await fetchCreditRisk()
    if (!minerFlow) minerFlow = await fetchMinerFlow()
    if (!narrative) narrative = await fetchNarrativeRotation()

    const data: Record<string, unknown> = {}
    if (action === "credit" || action === "all") data.creditRisk = creditRisk
    if (action === "miner" || action === "all") data.minerFlow = minerFlow
    if (action === "narrative" || action === "all") data.narrative = narrative

    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/risk-intel error:", error);
    return apiError("Failed to fetch risk intelligence", 502);
  }
}
