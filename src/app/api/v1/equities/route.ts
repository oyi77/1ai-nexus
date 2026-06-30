export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { registerAllModules } from "@/lib/modules";

const INDICES = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^IXIC", name: "NASDAQ" },
  { symbol: "^DJI", name: "Dow Jones" },
  { symbol: "^VIX", name: "VIX" },
  { symbol: "^FTSE", name: "FTSE 100" },
  { symbol: "^N225", name: "Nikkei 225" },
  { symbol: "^HSI", name: "Hang Seng" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50" },
] as const;

const DEFAULT_STOCKS = [
  "AAPL","MSFT","GOOGL","AMZN","NVDA","TSLA","META","AMD","AVGO",
  "JPM","GS","V","BAC","BRK-B","UNH","JNJ","PFE","LLY",
  "XOM","CVX","WMT","KO","PG","SAP.DE","MC.PA","7203.T","BABA",
  "0700.HK","BHP.AX","D05.SI","RELIANCE.NS","005930.KS","2330.TW",
  "VALE","PBR","BBCA.JK","BBRI.JK","BMRI.JK","TLKM.JK","ADRO.JK",
] as const;

const cache = new Map<string, { data: Record<string, unknown>; ts: number }>();
const CACHE_TTL = 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbolsParam = searchParams.get("symbols");
    const stockSymbols = symbolsParam
      ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [...DEFAULT_STOCKS];

    const allSymbols = [...new Set([...stockSymbols, ...INDICES.map((i) => i.symbol)])];
    const cacheKey = `equities:${allSymbols.join(",")}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL) {
      return cacheHeaders(apiSuccess(cached.data), 60);
    }

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

    const data = {
      stocks,
      indices,
      summary: {
        total: stocks.length + indices.length,
        stocksCount: stocks.length,
        indicesCount: indices.length,
      },
      timestamp: new Date().toISOString(),
    };

    cache.set(cacheKey, { data, ts: now });
    return cacheHeaders(apiSuccess(data), 60);
  } catch (error) {
    console.error("GET /api/v1/equities error:", error);
    return apiError("Internal server error", 500);
  }
}
