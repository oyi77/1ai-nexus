export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import * as fredClient from "@/lib/fred-client";

const COINMETRICS_API_KEY = process.env.COINMETRICS_API_KEY ?? "";

// FRED Series IDs
const FRED_SERIES: Record<string, { title: string; unit: string; category: string }> = {
  FEDFUNDS: { title: "Federal Funds Effective Rate", unit: "%", category: "rates" },
  DFF: { title: "Federal Funds Effective Rate (Daily)", unit: "%", category: "rates" },
  DGS2: { title: "2-Year Treasury Constant Maturity Rate", unit: "%", category: "rates" },
  DGS5: { title: "5-Year Treasury Constant Maturity Rate", unit: "%", category: "rates" },
  DGS10: { title: "10-Year Treasury Constant Maturity Rate", unit: "%", category: "rates" },
  DGS30: { title: "30-Year Treasury Constant Maturity Rate", unit: "%", category: "rates" },
  T10Y2Y: { title: "10Y-2Y Treasury Spread", unit: "%", category: "rates" },
  CPIAUCSL: { title: "Consumer Price Index for All Urban Consumers", unit: "Index", category: "inflation" },
  T10YIE: { title: "10-Year Breakeven Inflation Rate", unit: "%", category: "inflation" },
  UNRATE: { title: "Unemployment Rate", unit: "%", category: "employment" },
  ICSA: { title: "Initial Jobless Claims", unit: "Thousands", category: "employment" },
  PAYEMS: { title: "Total Nonfarm Payrolls", unit: "Thousands", category: "employment" },
  GDP: { title: "Gross Domestic Product", unit: "$B", category: "growth" },
  INDPRO: { title: "Industrial Production Index", unit: "Index", category: "growth" },
  M2SL: { title: "M2 Money Stock", unit: "$B", category: "monetary" },
  DTWEXBGS: { title: "Trade Weighted U.S. Dollar Index", unit: "Index", category: "cross-market" },
  VIXCLS: { title: "CBOE Volatility Index (VIX)", unit: "Index", category: "cross-market" },
  GOLDAMGBD228NLBM: { title: "Gold Price (London Fix)", unit: "$/oz", category: "cross-market" },
  DCOILWTICO: { title: "WTI Crude Oil Price", unit: "$/bbl", category: "cross-market" },
};

async function fetchFredSeries(seriesId: string, limit = 10) {
  return fredClient.getFredSeries(seriesId, limit);
}

async function fetchFredAll() {
  const results: Array<{ seriesId: string; title: string; unit: string; category: string; latestValue: number | null; latestDate: string | null }> = [];

  for (const [seriesId, meta] of Object.entries(FRED_SERIES)) {
    try {
      const series = await fetchFredSeries(seriesId, 1);
      const latest = series.observations[0];
      results.push({
        seriesId,
        title: meta.title,
        unit: meta.unit,
        category: meta.category,
        latestValue: latest ? parseFloat(latest.value) : null,
        latestDate: latest?.date ?? null,
      });
    } catch {
      results.push({
        seriesId,
        title: meta.title,
        unit: meta.unit,
        category: meta.category,
        latestValue: null,
        latestDate: null,
      });
    }
  }

  return results;
}

async function fetchCoinMetrics(assets: string[], metrics: string[]) {
  if (!COINMETRICS_API_KEY) throw new Error("COINMETRICS_API_KEY not configured");

  const assetList = assets.join(",");
  const metricList = metrics.join(",");
  const url = `https://api.coinmetrics.io/v4/timeseries/asset-metrics?assets=${assetList}&metrics=${metricList}&frequency=1d&page_size=1&pretty=false`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${COINMETRICS_API_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`CoinMetrics ${res.status}`);

  const response = await res.json();
  return response.data ?? [];
}

function computeRegime(indicators: Array<{ seriesId: string; value: number }>): { label: string; score: number } {
  let score = 0;
  let factors = 0;
  const map = Object.fromEntries(indicators.map((i) => [i.seriesId, i.value]));

  if (map.T10Y2Y !== undefined) {
    if (map.T10Y2Y < 0) score -= 2;
    else if (map.T10Y2Y > 1) score += 1;
    factors++;
  }
  if (map.VIXCLS !== undefined) {
    if (map.VIXCLS > 30) score -= 2;
    else if (map.VIXCLS < 15) score += 1;
    factors++;
  }
  if (map.DTWEXBGS !== undefined) {
    score += map.DTWEXBGS > 120 ? -1 : 0;
    factors++;
  }
  if (map.FEDFUNDS !== undefined) {
    score += map.FEDFUNDS > 5 ? -1 : map.FEDFUNDS < 1 ? 1 : 0;
    factors++;
  }

  const normalized = factors > 0 ? score / factors : 0;
  let label = "neutral";
  if (normalized > 0.5) label = "risk_on";
  else if (normalized < -0.5) label = "risk_off";
  else if (normalized > 0) label = "slightly_risk_on";
  else if (normalized < 0) label = "slightly_risk_off";

  return { label, score: normalized };
}

function classifyZone(indicator: string, value: number): string {
  const zones: Record<string, { euphoria: number; bull: number; neutral: number; accumulation: number; capitulation: number }> = {
    mvrv: { euphoria: 3.5, bull: 2.0, neutral: 1.0, accumulation: 0.7, capitulation: 0 },
    nupl: { euphoria: 0.7, bull: 0.4, neutral: 0, accumulation: -0.3, capitulation: -1 },
    sopr: { euphoria: 1.1, bull: 1.02, neutral: 1.0, accumulation: 0.98, capitulation: 0.95 },
    hashrate: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
    active_addresses: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
    fees_usd: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
    revenue_usd: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
    net_exchange_flow: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
  };

  const z = zones[indicator];
  if (!z) return "neutral";

  if (value >= z.euphoria) return "euphoria";
  if (value >= z.bull) return "bull";
  if (value >= z.neutral) return "neutral";
  if (value >= z.accumulation) return "accumulation";
  return "capitulation";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action") ?? "fred";
    const series = searchParams.get("series") ?? "FEDFUNDS";
    const assets = searchParams.get("assets") ?? "btc,eth,sol,arb,op";
    const metrics = searchParams.get("metrics") ?? "PriceUSD,MVRVRatio,NUPL,SOPR,HashRate,AdrActCnt,FeeTotUSD,NetFlowExUSD";
    const asset = searchParams.get("asset") ?? "BTC";

    switch (action) {
      case "fred": {
        const seriesData = await fetchFredSeries(series, 20);
        const meta = FRED_SERIES[series] ?? { title: series, unit: "", category: "unknown" };
        const r = apiSuccess({
          seriesId: series,
          title: meta.title,
          unit: meta.unit,
          category: meta.category,
          observations: seriesData.observations,
        });
        r.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
        return r;
      }

      case "fred/all": {
        const data = await fetchFredAll();
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
        return r;
      }

      case "coinmetrics": {
        const assetList = assets.split(",").map((s) => s.trim().toLowerCase());
        const metricList = metrics.split(",").map((s) => s.trim());
        const data = await fetchCoinMetrics(assetList, metricList);
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=900, stale-while-revalidate=1800");
        return r;
      }

      case "regime": {
        // Get key FRED indicators
        const keySeries = ["FEDFUNDS", "T10Y2Y", "VIXCLS", "DTWEXBGS"];
        const indicators = [];
        for (const s of keySeries) {
          const seriesData = await fetchFredSeries(s, 1);
          if (seriesData.observations.length > 0) {
            indicators.push({ seriesId: s, value: parseFloat(seriesData.observations[0].value) });
          }
        }
        const regime = computeRegime(indicators);
        const r = apiSuccess({ regime, indicators });
        r.headers.set("Cache-Control", "public, max-age=900, stale-while-revalidate=1800");
        return r;
      }

      case "cycle": {
        // Get CoinMetrics cycle indicators for BTC/ETH
        const assetList = asset === "ETH" ? ["eth"] : ["btc"];
        const metricList = ["MVRVRatio", "NUPL", "SOPR", "HashRate", "AdrActCnt", "FeeTotUSD", "NetFlowExUSD"];
        const data = await fetchCoinMetrics(assetList, metricList);

        const indicators = data[0] ?? {};
        const cycleIndicators = Object.entries(indicators)
          .filter(([k]) => metricList.includes(k))
          .map(([k, v]) => {
            const numValue = typeof v === "string" ? parseFloat(v) : (v as number);
            return {
              indicator: k.toLowerCase().replace(/ratio$/, ""),
              value: numValue,
              zone: classifyZone(k.toLowerCase().replace(/ratio$/, ""), numValue),
            };
          });

        const r = apiSuccess({ asset, indicators: cycleIndicators });
        r.headers.set("Cache-Control", "public, max-age=900, stale-while-revalidate=1800");
        return r;
      }

      case "health": {
        const fredOk = (await fetchFredSeries("FEDFUNDS", 1)).observations.length > 0;
        const cmOk = !!COINMETRICS_API_KEY;
        const r = apiSuccess({ fredAvailable: fredOk, coinmetricsAvailable: cmOk });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      default:
        return apiError(
          `Unknown action: ${action}. Use: fred, fred/all, coinmetrics, regime, cycle, health`,
          400
        );
    }
  } catch (error) {
    console.error("GET /api/v1/macro error:", error);
    return apiError("Macro request failed", 502);
  }
}