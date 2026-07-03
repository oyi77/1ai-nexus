// ─────────────────────────────────────────────────────────────
// GET /api/v1/options-intel — Derivatives Intelligence
// Options max pain, term structure, funding rate heatmap
// All public APIs, zero API keys
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import {
  fetchOptionsIntelSnapshot,
  fetchMaxPain,
  fetchTermStructure,
  fetchFundingHeatmap,
  persistOptionsIntelSnapshot,
} from "@/lib/modules/derivatives/options-intel";
import { cacheGet, cacheSet } from "@/lib/cache"

export const dynamic = "force-dynamic";

const CACHE_KEY = "options-intel:snapshot";
const CACHE_TTL = 120; // 2 min

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";

    // Try cache first
    const cached = await cacheGet<{
      maxPain: unknown[];
      termStructure: unknown[];
      fundingHeatmap: unknown[];
      timestamp: string;
    }>(CACHE_KEY);

    if (cached && action === "all") {
      return cacheHeaders(apiSuccess(cached), CACHE_TTL);
    }

    // Fetch fresh data
    let data;

    if (action === "all") {
      data = await fetchOptionsIntelSnapshot();
      await cacheSet(CACHE_KEY, data, CACHE_TTL);
    } else if (action === "max-pain") {
      const currency = (request.nextUrl.searchParams.get("currency") ?? "BTC").toUpperCase() as "BTC" | "ETH";
      const maxPain = await fetchMaxPain(currency);
      data = { maxPain, timestamp: new Date().toISOString() };
    } else if (action === "term-structure") {
      const currency = (request.nextUrl.searchParams.get("currency") ?? "BTC").toUpperCase() as "BTC" | "ETH";
      const term = await fetchTermStructure(currency);
      data = { termStructure: [term], timestamp: new Date().toISOString() };
    } else if (action === "funding-heatmap") {
      const heatmap = await fetchFundingHeatmap();
      data = { fundingHeatmap: heatmap, timestamp: new Date().toISOString() };
    } else {
      return apiError(`Unknown action: ${action}. Use: all, max-pain, term-structure, funding-heatmap`, 400);
    }

    // Persist to DB for backtesting (fire-and-forget)
    if (action === "all" && data && 'maxPain' in data) {
      persistOptionsIntelSnapshot(data as import("@/lib/modules/derivatives/options-intel").OptionsIntelSnapshot).catch(() => {});
    }

    return cacheHeaders(apiSuccess(data), CACHE_TTL);
  } catch (error) {
    console.error("GET /api/v1/options-intel error:", error);
    return apiError("Failed to fetch options intelligence", 502);
  }
}
