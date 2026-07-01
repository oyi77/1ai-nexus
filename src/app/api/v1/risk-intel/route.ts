import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchCreditRisk, persistCreditRisk } from "@/lib/modules/defi/credit-risk";
import { fetchMinerFlow, persistMinerFlow } from "@/lib/modules/chain/miner-flow";
import { fetchNarrativeRotation, persistSectorFlows } from "@/lib/modules/derived/narrative-rotation";
import { cacheGet } from "@/lib/data-refresher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    let creditRisk = await cacheGet<Awaited<ReturnType<typeof fetchCreditRisk>>>('risk:credit')
    let minerFlow = await cacheGet<Awaited<ReturnType<typeof fetchMinerFlow>>>('risk:miner')
    let narrative = await cacheGet<Awaited<ReturnType<typeof fetchNarrativeRotation>>>('risk:narrative')
    if (!creditRisk) creditRisk = await fetchCreditRisk()
    if (!minerFlow) minerFlow = await fetchMinerFlow()
    if (!narrative) narrative = await fetchNarrativeRotation()

    // Persist to DB for backtesting (fire-and-forget)
    if (creditRisk?.length > 0) persistCreditRisk(creditRisk).catch(() => {})
    if (minerFlow) persistMinerFlow(minerFlow).catch(() => {})
    if (narrative?.length > 0) persistSectorFlows(narrative).catch(() => {})

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
