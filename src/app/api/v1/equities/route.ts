// ─────────────────────────────────────────────────────────────
// GET /api/v1/equities — Global equities + indices quote data
// Uses single-flight getCached Redis cache + backup fallback
// ─────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import { registerAllModules } from "@/lib/modules";
import { getCached } from "@/lib/api/server-cache";
import { INDICES, EQUITIES_DEFAULT_SYMBOLS as DEFAULT_STOCKS } from "@/lib/config/universe";
import { saveBackup, getBackup } from "@/lib/api/backup";

/** Short stable hash for long cache keys (symbol-set dependent caching). */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbolsParam = searchParams.get("symbols");
  const stockSymbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_STOCKS];
  const allSymbols = [...new Set([...stockSymbols, ...INDICES.map((i) => i.symbol)])];

  const symbolSetKey = [...allSymbols].sort().join(",");
  const cacheKey = `equities:${symbolSetKey.length <= 100 ? symbolSetKey : djb2(symbolSetKey)}`; // key reflects the requested symbol set

  try {
    const { data, fromCache } = await getCached(cacheKey, 60_000, async () => {
      const registry = registerAllModules();
      const result = await registry.fetchOne("yahoo-finance", { symbols: allSymbols.join(","), action: "quote" });
      const quotes = (result?.data as Array<Record<string, unknown>> | null) ?? [];

      const indicesSet = new Set<string>(INDICES.map((i) => i.symbol));
      const indexMeta = new Map<string, string>(INDICES.map((i) => [i.symbol, i.name]));
      const stocks: Array<Record<string, unknown>> = [];
      const indices: Array<Record<string, unknown>> = [];

      for (const quote of quotes) {
        const symbol = String(quote.symbol ?? "");
        const entry = {
          symbol,
          name: indexMeta.get(symbol) ?? String(quote.shortName ?? quote.longName ?? symbol),
          price: (quote.price as number | undefined) ?? (quote.regularMarketPrice as number | undefined) ?? null,
          change: (quote.change as number | undefined) ?? (quote.regularMarketChange as number | undefined) ?? null,
          changePercent: (quote.changePercent as number | undefined) ?? (quote.regularMarketChangePercent as number | undefined) ?? null,
          volume: (quote.volume as number | undefined) ?? (quote.regularMarketVolume as number | undefined) ?? null,
          marketCap: (quote.marketCap as number | undefined) ?? null,
          sector: (quote.sector as string | undefined) ?? null,
        };
        if (indicesSet.has(symbol)) indices.push(entry);
        else stocks.push(entry);
      }

      const payload = {
        stocks,
        indices,
        summary: {
          total: stocks.length + indices.length,
          stocksCount: stocks.length,
          indicesCount: indices.length,
        },
        timestamp: new Date().toISOString(),
      };

      // Save to permanent backup (fire-and-forget)
      saveBackup("equities", payload).catch(() => {});

      return payload;
    });

    const resp = NextResponse.json({ data, error: null }, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" }
    });
    resp.headers.set("X-Cache", fromCache ? "HIT" : "MISS");
    return resp;
  } catch (error) {
    console.error("GET /api/v1/equities error, loading from backup:", error);
    try {
      const backup = await getBackup("equities");
      if (backup) {
        const resp = NextResponse.json({ data: backup, error: null, note: "Loaded from historical cache" }, {
          headers: { "Cache-Control": "public, max-age=30" }
        });
        resp.headers.set("X-Cache", "HIT-BACKUP");
        return resp;
      }
    } catch (dbErr) {
      console.error("[equities] DB Backup loading failed:", dbErr);
    }
    return apiError("Failed to fetch equities data", 502);
  }
}
