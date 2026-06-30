export const dynamic = "force-dynamic";

import { apiSuccess, apiError } from "@/lib/api/response";
import { getTickers } from "@/lib/coinpaprika";

export async function GET() {
  try {
    // Fetch all tickers and detect stablecoins dynamically
    // Stablecoins = price within 2% of $1.00 AND market cap > $10M
    const allTickers = await getTickers(500);
    const stablecoins = allTickers
      .filter((t) => {
        const price = t.price;
        const deviation = Math.abs(price - 1.0);
        return deviation < 0.02 && t.marketCap > 10_000_000;
      })
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 20)
      .map((t) => {
        const deviation = Math.abs(t.price - 1.0) * 100;
        const pegStatus = deviation < 0.5 ? "ON PEG" : deviation < 2 ? "SLIGHT DEPEG" : "DEPEG";
        return {
          id: t.id,
          name: t.name,
          symbol: t.symbol,
          price: t.price,
          deviation,
          pegStatus,
          change24h: t.change24h,
          volume24h: t.volume24h,
          marketCap: t.marketCap,
        };
      });

    const totalMarketCap = stablecoins.reduce((s, c) => s + c.marketCap, 0);
    const totalVolume24h = stablecoins.reduce((s, c) => s + c.volume24h, 0);
    const depeggedCount = stablecoins.filter((c) => c.pegStatus === "DEPEG").length;
    const slightDepegCount = stablecoins.filter((c) => c.pegStatus === "SLIGHT DEPEG").length;
    const healthStatus = depeggedCount > 0 ? "WARNING" : slightDepegCount > 0 ? "CAUTION" : "HEALTHY";

    const r = apiSuccess({
      stablecoins,
      summary: { totalMarketCap, totalVolume24h, coinCount: stablecoins.length, depeggedCount: depeggedCount + slightDepegCount, healthStatus },
    })
    r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    return r
  } catch (error) {
    console.error("GET /api/v1/stablecoins error:", error);
    return apiError("Failed to fetch stablecoin data", 502);
  }
}
