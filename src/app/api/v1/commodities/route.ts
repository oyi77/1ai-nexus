// ─────────────────────────────────────────────────────────────
// GET /api/v1/commodities — Commodity futures data
// Uses single-flight getCached Redis cache + backup fallback
// ─────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import { registerAllModules } from "@/lib/modules";
import { getCached } from "@/lib/api/server-cache";
import { saveBackup, getBackup } from "@/lib/api/backup";

import { COMMODITY_GROUPS, ALL_COMMODITIES } from "@/lib/config/universe";

// Same wire shape as before (category-slug → items), sourced from central config.
const COMMODITY_CATEGORIES = Object.fromEntries(
  COMMODITY_GROUPS.map((g) => [
    g.category.replace(/[^a-zA-Z]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase(),
    g.items,
  ]),
);

export async function GET(_request: NextRequest) {
  const cacheKey = "commodities:all";

  try {
    const { data, fromCache } = await getCached(cacheKey, 300_000, async () => {
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

      const payload = {
        commodities,
        categories: COMMODITY_CATEGORIES,
        summary: {
          total: commodities.length,
          live: commodities.filter((c) => c.price != null).length,
        },
        timestamp: new Date().toISOString(),
      };

      // Save to permanent backup (fire-and-forget)
      saveBackup("commodities", payload).catch(() => {});

      return payload;
    });

    const resp = NextResponse.json({ data, error: null }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" }
    });
    resp.headers.set("X-Cache", fromCache ? "HIT" : "MISS");
    return resp;
  } catch (error) {
    console.error("GET /api/v1/commodities error, loading from backup:", error);
    try {
      const backup = await getBackup("commodities");
      if (backup) {
        const resp = NextResponse.json({ data: backup, error: null, note: "Loaded from historical cache" }, {
          headers: { "Cache-Control": "public, max-age=60" }
        });
        resp.headers.set("X-Cache", "HIT-BACKUP");
        return resp;
      }
    } catch (dbErr) {
      console.error("[commodities] DB Backup loading failed:", dbErr);
    }
    return apiError("Failed to fetch commodities data", 502);
  }
}
