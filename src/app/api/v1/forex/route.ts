// ─────────────────────────────────────────────────────────────
// GET /api/v1/forex — Forex exchange rates
// Uses single-flight getCached Redis cache + backup fallback
// ─────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import { registerAllModules } from "@/lib/modules";
import { getCached } from "@/lib/api/server-cache";
import { saveBackup, getBackup } from "@/lib/api/backup";

interface ForexPayload {
  rates: Record<string, number>
  base: string
  timestamp: string
}

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
  const { searchParams } = request.nextUrl;
  const base = (searchParams.get("base") ?? "USD").toUpperCase();
  const cacheKey = `forex:${base}`;

  try {
    const { data, fromCache } = await getCached(cacheKey, 300_000, async () => {
      const registry = registerAllModules();

      try {
        const result = await registry.fetchOne("exchangerate-api", { base });
        const payload = (result?.data as ForexPayload | null) ?? { rates: {}, base, timestamp: new Date().toISOString() };
        if (payload && payload.rates && Object.keys(payload.rates).length > 0) {
          saveBackup(cacheKey, payload).catch(() => {});
          return payload;
        }
        throw new Error("Empty rates returned");
      } catch (e) {
        console.warn(`[forex] Primary source failed for base ${base}, trying Yahoo fallback:`, (e as Error).message);
        const symbols = Object.values(FALLBACK_PAIRS).join(",");
        const result = await registry.fetchOne("yahoo-finance", { symbols, action: "quote" });
        const quotes = (result?.data as Array<Record<string, unknown>> | null) ?? [];

        const rates: Record<string, number> = {};
        for (const [code, symbol] of Object.entries(FALLBACK_PAIRS)) {
          const q = quotes.find((row) => row.symbol === symbol);
          const price = (q?.price as number | undefined) ?? (q?.regularMarketPrice as number | undefined);
          if (price != null) rates[code] = price;
        }

        const payload: ForexPayload = { rates, base, timestamp: new Date().toISOString() };
        saveBackup(cacheKey, payload).catch(() => {});
        return payload;
      }
    });

    const resp = NextResponse.json({ data, error: null }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" }
    });
    resp.headers.set("X-Cache", fromCache ? "HIT" : "MISS");
    return resp;
  } catch (error) {
    console.error(`GET /api/v1/forex error for base ${base}, loading from backup:`, error);
    try {
      const backup = await getBackup<ForexPayload>(cacheKey);
      if (backup) {
        const resp = NextResponse.json({ data: backup, error: null, note: "Loaded from historical cache" }, {
          headers: { "Cache-Control": "public, max-age=60" }
        });
        resp.headers.set("X-Cache", "HIT-BACKUP");
        return resp;
      }
    } catch (dbErr) {
      console.error(`[forex] DB Backup loading failed for base ${base}:`, dbErr);
    }
    return apiError("Failed to fetch forex rates", 502);
  }
}
