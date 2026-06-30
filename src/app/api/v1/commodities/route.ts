export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { registerAllModules } from "@/lib/modules";

const COMMODITY_GROUPS = {
  precious_metals: [
    { symbol: "GC=F", name: "Gold", unit: "$/oz" },
    { symbol: "SI=F", name: "Silver", unit: "$/oz" },
    { symbol: "PL=F", name: "Platinum", unit: "$/oz" },
    { symbol: "PA=F", name: "Palladium", unit: "$/oz" },
  ],
  energy: [
    { symbol: "CL=F", name: "WTI Crude Oil", unit: "$/bbl" },
    { symbol: "BZ=F", name: "Brent Crude", unit: "$/bbl" },
    { symbol: "NG=F", name: "Natural Gas", unit: "$/MMBtu" },
    { symbol: "HO=F", name: "Heating Oil", unit: "$/gal" },
    { symbol: "RB=F", name: "RBOB Gasoline", unit: "$/gal" },
  ],
  industrial_metals: [{ symbol: "HG=F", name: "Copper", unit: "$/lb" }],
  agriculture: [
    { symbol: "ZC=F", name: "Corn", unit: "$/bu" },
    { symbol: "ZW=F", name: "Wheat", unit: "$/bu" },
    { symbol: "ZS=F", name: "Soybeans", unit: "$/bu" },
    { symbol: "KC=F", name: "Coffee", unit: "$/lb" },
    { symbol: "SB=F", name: "Sugar", unit: "$/lb" },
    { symbol: "CT=F", name: "Cotton", unit: "$/lb" },
    { symbol: "CC=F", name: "Cocoa", unit: "$/mt" },
  ],
  livestock: [
    { symbol: "LE=F", name: "Live Cattle", unit: "$/lb" },
    { symbol: "HE=F", name: "Lean Hogs", unit: "$/lb" },
  ],
} as const;

const ALL_COMMODITIES = Object.values(COMMODITY_GROUPS).flat();
const cache = new Map<string, { data: Record<string, unknown>; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(_request: NextRequest) {
  try {
    const now = Date.now();
    const cacheKey = "commodities:all";
    const cached = cache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL) {
      return cacheHeaders(apiSuccess(cached.data), 300);
    }

    const registry = registerAllModules();
    const symbols = ALL_COMMODITIES.map((item) => item.symbol).join(",");
    const result = await registry.fetchOne("yahoo-finance", { symbols, action: "quote" });
    const quotes = (result?.data as Array<Record<string, unknown>> | null) ?? [];

    const bySymbol = new Map(quotes.map((q) => [String(q.symbol), q]));
    const commodities = ALL_COMMODITIES.map((meta) => {
      const q = bySymbol.get(meta.symbol);
      return {
        symbol: meta.symbol,
        name: meta.name,
        unit: meta.unit,
        price: (q?.price as number | undefined) ?? (q?.regularMarketPrice as number | undefined) ?? null,
        change: (q?.change as number | undefined) ?? (q?.regularMarketChange as number | undefined) ?? null,
        changePercent: (q?.changePercent as number | undefined) ?? (q?.regularMarketChangePercent as number | undefined) ?? null,
        prevClose: (q?.regularMarketPreviousClose as number | undefined) ?? null,
        volume: (q?.volume as number | undefined) ?? (q?.regularMarketVolume as number | undefined) ?? null,
      };
    });

    const data = {
      commodities,
      categories: COMMODITY_GROUPS,
      summary: {
        total: commodities.length,
        live: commodities.filter((c) => c.price != null).length,
      },
      timestamp: new Date().toISOString(),
    };

    cache.set(cacheKey, { data, ts: now });
    return cacheHeaders(apiSuccess(data), 300);
  } catch (error) {
    console.error("GET /api/v1/commodities error:", error);
    return apiError("Internal server error", 500);
  }
}
