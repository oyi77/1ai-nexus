// ─────────────────────────────────────────────────────────────
// GET /api/v1/derivatives-intel — Real derivatives intelligence
// Binance, Bybit, OKX funding rates, OI, long/short ratios
// Zero API keys — all public REST endpoints
// ─────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { fetchDerivativesSnapshot, fetchRecentLiquidations, persistDerivativesSnapshot, persistLiquidations } from "@/lib/modules/derived/derivatives-intel";


export const dynamic = "force-dynamic";

// Cache for 30 seconds (derivatives data is time-sensitive)
let cachedData: unknown = null;
let cacheTs = 0;
const CACHE_TTL = 30 * 1000;

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    const now = Date.now();

    if (action === "snapshot" || action === "all") {
      if (!cachedData || now - cacheTs > CACHE_TTL) {
        const snapshots = await fetchDerivativesSnapshot();
        cachedData = {
          snapshots,
          summary: computeSummary(snapshots),
        };
        persistDerivativesSnapshot(snapshots).catch(() => {})
        cacheTs = now;
      }
    }

    if (action === "liquidations" || action === "all") {
      const liquidations = await fetchRecentLiquidations();
      (cachedData as Record<string, unknown>).liquidations = liquidations;
      persistLiquidations(liquidations).catch(() => {})
    }


    return cacheHeaders(apiSuccess(cachedData), 30);
  } catch (error) {
    console.error("GET /api/v1/derivatives-intel error:", error);
    return apiError("Failed to fetch derivatives intelligence", 502);
  }
}

function computeSummary(snapshots: Array<{ fundingRate: number; exchange: string; symbol: string; openInterest: number; longShortRatio: number | null }>) {
  const avgFunding = snapshots.length > 0
    ? snapshots.reduce((s, d) => s + d.fundingRate, 0) / snapshots.length
    : 0;

  const topFunding = snapshots
    .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate))
    .slice(0, 5)
    .map(d => ({ exchange: d.exchange, symbol: d.symbol, fundingRate: d.fundingRate }));

  const totalOI = snapshots.reduce((s, d) => s + d.openInterest, 0);

  const btcData = snapshots.find(d => d.symbol.includes('BTC'));
  const ethData = snapshots.find(d => d.symbol.includes('ETH'));

  return {
    avgFundingRate: avgFunding,
    topFunding,
    totalOpenInterest: totalOI,
    btcFunding: btcData?.fundingRate ?? null,
    ethFunding: ethData?.fundingRate ?? null,
    btcOI: btcData?.openInterest ?? null,
    ethOI: ethData?.openInterest ?? null,
    btcLongShort: btcData?.longShortRatio ?? null,
    exchangeCount: new Set(snapshots.map(d => d.exchange)).size,
    symbolCount: new Set(snapshots.map(d => d.symbol)).size,
    timestamp: new Date().toISOString(),
  };
}
