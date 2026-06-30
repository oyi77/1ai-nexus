export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { registerAllModules } from "@/lib/modules";

interface ForexPayload {
  rates: Record<string, number>
  base: string
  timestamp: string
}

const cache = new Map<string, { data: ForexPayload; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

const FALLBACK_PAIRS: Record<string, string> = {
  EUR: "EURUSD=X",
  GBP: "GBPUSD=X",
  JPY: "USDJPY=X",
  CHF: "USDCHF=X",
  CNY: "USDCNY=X",
  AUD: "AUDUSD=X",
  CAD: "USDCAD=X",
  SGD: "USDSGD=X",
  HKD: "USDHKD=X",
  IDR: "USDIDR=X",
  KRW: "USDKRW=X",
  THB: "USDTHB=X",
  MYR: "USDMYR=X",
  PHP: "USDPHP=X",
  VND: "USDVND=X",
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const base = (searchParams.get("base") ?? "USD").toUpperCase();
    const cacheKey = `forex:${base}`;
    const now = Date.now();

    const cached = cache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL) {
      return cacheHeaders(apiSuccess(cached.data), 300);
    }

    const registry = registerAllModules();

    try {
      const result = await registry.fetchOne("exchangerate-api", { base });
      const data = (result?.data as ForexPayload | null) ?? { rates: {}, base, timestamp: new Date().toISOString() };
      cache.set(cacheKey, { data, ts: now });
      return cacheHeaders(apiSuccess(data), 300);
    } catch {
      const symbols = Object.values(FALLBACK_PAIRS).join(",");
      const result = await registry.fetchOne("yahoo-finance", { symbols, action: "quote" });
      const quotes = (result?.data as Array<Record<string, unknown>> | null) ?? [];

      const rates: Record<string, number> = {};
      for (const [code, symbol] of Object.entries(FALLBACK_PAIRS)) {
        const q = quotes.find((row) => row.symbol === symbol);
        const price = (q?.price as number | undefined) ?? (q?.regularMarketPrice as number | undefined);
        if (price != null) rates[code] = price;
      }

      const data: ForexPayload = { rates, base, timestamp: new Date().toISOString() };
      cache.set(cacheKey, { data, ts: now });
      return cacheHeaders(apiSuccess(data), 300);
    }
  } catch (error) {
    console.error("GET /api/v1/forex error:", error);
    return apiError("Internal server error", 500);
  }
}
