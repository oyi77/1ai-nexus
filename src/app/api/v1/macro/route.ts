import { type NextRequest } from "next/server";
import { apiSuccess, apiError, cacheHeaders } from "@/lib/api/response";
import { getFredSeries, FRED_SERIES, type FredObservation } from "@/lib/fred-client";

export const dynamic = "force-dynamic";

// ─── Category map ─────────────────────────────────────────

const CATEGORIES: Record<string, string[]> = {
  rates:        ["FEDFUNDS", "DFF", "DGS10", "DGS2", "T10Y2Y"],
  inflation:    ["CPIAUCSL", "T10YIE", "T5YIFR"],
  employment:   ["UNRATE", "ICSA", "PAYEMS"],
  growth:       ["GDP", "INDPRO"],
  "real-estate": ["HOUST", "MORTGAGE30US"],
  sentiment:    ["UMCSENT"],
  monetary:     ["M2SL"],
  "cross-market": ["DTWEXBGS", "DCOILWTICO", "GOLDAMGBD228NLBM", "SP500", "VIXCLS"],
};

// ─── Response types ───────────────────────────────────────

interface MacroIndicator {
  id: string;
  name: string;
  category: string;
  latestValue: number;
  latestDate: string;
  previousValue: number;
  change: number;
  changePercent: number;
  unit: string;
  trend: "up" | "down" | "flat";
}


interface MacroResponse {
  indicators: MacroIndicator[];
  yieldCurve: { spread10Y2Y: number; signal: string };
  summary: {
    gdpGrowth: number;
    inflationRate: number;
    unemploymentRate: number;
    fedRate: number;
  };
}

// ─── Cache ────────────────────────────────────────────────

let cachedData: MacroResponse | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Helpers ──────────────────────────────────────────────

function buildIndicator(
  seriesId: string,
  observations: FredObservation[],
): MacroIndicator | null {
  const meta = FRED_SERIES[seriesId];
  if (!meta || observations.length === 0) return null;

  const latest = parseFloat(observations[0].value);
  const previous = observations.length > 1 ? parseFloat(observations[1].value) : latest;
  const change = latest - previous;
  const changePercent = previous !== 0 ? (change / Math.abs(previous)) * 100 : 0;

  let trend: "up" | "down" | "flat" = "flat";
  if (change > 0.001) trend = "up";
  else if (change < -0.001) trend = "down";

  return {
    id: seriesId,
    name: meta.title,
    category: meta.category,
    latestValue: latest,
    latestDate: observations[0].date,
    previousValue: previous,
    change,
    changePercent,
    unit: meta.unit,
    trend,
  };
}

// ─── Handler ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get("category") ?? "all";

    // Return cached if fresh
    if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
      if (category === "all") return cacheHeaders(apiSuccess(cachedData), 3600);
      return cacheHeaders(apiSuccess({
        ...cachedData,
        indicators: cachedData.indicators.filter(
          (i) => i.category === category || category === "all",
        ),
      }), 3600);
    }

    // getFredSeries now uses World Bank API + fallback internally (no key required)

    // Determine which series to fetch
    const allSeriesIds =
      category === "all"
        ? Object.keys(FRED_SERIES)
        : CATEGORIES[category] ?? Object.keys(FRED_SERIES);

    // Fetch all series in parallel
    const results = await Promise.allSettled(
      allSeriesIds.map((id) => getFredSeries(id, 5)),
    );

    // Build indicators
    const indicators: MacroIndicator[] = [];
    const seriesMap = new Map<string, FredObservation[]>();

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { id, observations } = result.value;
        seriesMap.set(id, observations);
        const indicator = buildIndicator(id, observations);
        if (indicator) indicators.push(indicator);
      }
    }

    // Yield curve
    const t10 = seriesMap.get("DGS10");
    const t2 = seriesMap.get("DGS2");
    let spread10Y2Y = 0;
    if (t10?.[0] && t2?.[0]) {
      spread10Y2Y = parseFloat(t10[0].value) - parseFloat(t2[0].value);
    }
    const yieldCurveSignal =
      spread10Y2Y < -0.1 ? "Inverted" : spread10Y2Y < 0.2 ? "Flat" : "Normal";

    // Summary
    const findLatest = (id: string): number => {
      const obs = seriesMap.get(id);
      return obs?.[0] ? parseFloat(obs[0].value) : 0;
    };

    const response: MacroResponse = {
      indicators,
      yieldCurve: { spread10Y2Y, signal: yieldCurveSignal },
      summary: {
        gdpGrowth: findLatest("GDP"),
        inflationRate: findLatest("CPIAUCSL"),
        unemploymentRate: findLatest("UNRATE"),
        fedRate: findLatest("FEDFUNDS"),
      },
    };

    // Update cache
    cachedData = response;
    cacheTimestamp = Date.now();

    if (category === "all") return cacheHeaders(apiSuccess(response), 3600);
    return cacheHeaders(apiSuccess({
      ...response,
      indicators: response.indicators.filter(
        (i) => i.category === category || category === "all",
      ),
    }), 3600);
  } catch (error) {
    console.error("GET /api/v1/macro error:", error);
    return cacheHeaders(apiError("Failed to fetch data", 502), 3600);
  }
}
