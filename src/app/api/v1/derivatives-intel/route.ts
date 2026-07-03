// ─────────────────────────────────────────────────────────────
// GET /api/v1/derivatives-intel — Real derivatives intelligence
// Reads from Redis cache (background-refreshed), falls back to live fetch
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchDerivativesSnapshot, fetchRecentLiquidations, persistDerivativesSnapshot, persistLiquidations } from "@/lib/modules/derived/derivatives-intel";
import { cacheGet } from "@/lib/cache"

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";

    let snapshots = await cacheGet<Awaited<ReturnType<typeof fetchDerivativesSnapshot>>>('derivatives:snapshots')
    let liquidations = await cacheGet<Awaited<ReturnType<typeof fetchRecentLiquidations>>>('derivatives:liquidations')

    if (!snapshots) snapshots = await fetchDerivativesSnapshot()
    if (!liquidations) liquidations = await fetchRecentLiquidations()

    // Persist to DB for backtesting (fire-and-forget)
    if (snapshots.length > 0) persistDerivativesSnapshot(snapshots).catch(() => {})
    if (liquidations.length > 0) persistLiquidations(liquidations).catch(() => {})

    const data: Record<string, unknown> = {}
    if (action === "snapshot" || action === "all") {
      data.snapshots = snapshots
      data.summary = computeSummary(snapshots)
    }
    if (action === "liquidations" || action === "all") data.liquidations = liquidations

    return cacheHeaders(apiSuccess(data), 15);
  } catch (error) {
    console.error("GET /api/v1/derivatives-intel error:", error);
    return apiError("Failed to fetch derivatives intelligence", 502);
  }
}

function computeSummary(snapshots: Array<{ fundingRate: number; exchange: string; symbol: string; openInterest: number; longShortRatio: number | null }>) {
  const avgFunding = snapshots.length > 0 ? snapshots.reduce((s, d) => s + d.fundingRate, 0) / snapshots.length : 0;
  const topFunding = snapshots.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)).slice(0, 5).map(d => ({ exchange: d.exchange, symbol: d.symbol, fundingRate: d.fundingRate }));
  const totalOI = snapshots.reduce((s, d) => s + d.openInterest, 0);
  const btcData = snapshots.find(d => d.symbol.includes('BTC'));
  const ethData = snapshots.find(d => d.symbol.includes('ETH'));
  return {
    avgFundingRate: avgFunding, topFunding, totalOpenInterest: totalOI,
    btcFunding: btcData?.fundingRate ?? null, ethFunding: ethData?.fundingRate ?? null,
    btcOI: btcData?.openInterest ?? null, ethOI: ethData?.openInterest ?? null,
    btcLongShort: btcData?.longShortRatio ?? null,
    exchangeCount: new Set(snapshots.map(d => d.exchange)).size,
    symbolCount: new Set(snapshots.map(d => d.symbol)).size,
    timestamp: new Date().toISOString(),
  };
}
