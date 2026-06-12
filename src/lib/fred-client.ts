// ─── FRED (Federal Reserve Economic Data) API Client ─────
// Free tier: DEMO_KEY works for low-volume requests
// Docs: https://fred.stlouisfed.org/docs/api/fred/

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const API_KEY = process.env.FRED_API_KEY ?? "";

// ─── Types ────────────────────────────────────────────────

export interface FredObservation {
  date: string;
  value: string;
}

export interface FredSeries {
  id: string;
  title: string;
  observations: FredObservation[];
}

interface FredApiResponse {
  observations: Array<{
    date: string;
    value: string;
    realtime_start: string;
    realtime_end: string;
  }>;
}

// ─── Key FRED Series ──────────────────────────────────────

export const FRED_SERIES: Record<string, { title: string; unit: string; category: string }> = {
  // ─── Rates ────────────────────────────────────────────
  FEDFUNDS:             { title: "Federal Funds Effective Rate",              unit: "%",       category: "rates" },
  DFF:                  { title: "Federal Funds Effective Rate (Daily)",      unit: "%",       category: "rates" },
  DGS10:                { title: "10-Year Treasury Constant Maturity Rate",   unit: "%",       category: "rates" },
  DGS2:                 { title: "2-Year Treasury Constant Maturity Rate",    unit: "%",       category: "rates" },
  T10Y2Y:               { title: "10Y-2Y Treasury Spread",                   unit: "%",       category: "rates" },

  // ─── Inflation ────────────────────────────────────────
  CPIAUCSL:             { title: "Consumer Price Index for All Urban Consumers", unit: "Index", category: "inflation" },
  T10YIE:               { title: "10-Year Breakeven Inflation Rate",          unit: "%",       category: "inflation" },
  T5YIFR:               { title: "5-Year Forward Inflation Expectation Rate", unit: "%",       category: "inflation" },

  // ─── Employment ───────────────────────────────────────
  UNRATE:               { title: "Unemployment Rate",                         unit: "%",       category: "employment" },
  ICSA:                 { title: "Initial Jobless Claims",                    unit: "Thousands", category: "employment" },
  PAYEMS:               { title: "Total Nonfarm Payrolls",                    unit: "Thousands", category: "employment" },

  // ─── Growth ───────────────────────────────────────────
  GDP:                  { title: "Gross Domestic Product",                    unit: "$B",      category: "growth" },
  INDPRO:               { title: "Industrial Production Index",               unit: "Index",   category: "growth" },

  // ─── Real Estate ───────────────────────────────────────
  HOUST:                { title: "Housing Starts",                            unit: "Thousands", category: "real-estate" },
  MORTGAGE30US:         { title: "30-Year Fixed Rate Mortgage Average",       unit: "%",       category: "real-estate" },

  // ─── Sentiment ────────────────────────────────────────
  UMCSENT:              { title: "University of Michigan Consumer Sentiment", unit: "Index",   category: "sentiment" },

  // ─── Monetary ──────────────────────────────────────────
  M2SL:                 { title: "M2 Money Stock",                            unit: "$B",      category: "monetary" },

  // ─── Cross-Market ────────────────────────────────────
  DTWEXBGS:             { title: "Trade Weighted U.S. Dollar Index",          unit: "Index",   category: "cross-market" },
  DCOILWTICO:           { title: "WTI Crude Oil Price",                       unit: "$/bbl",   category: "cross-market" },
  GOLDAMGBD228NLBM:     { title: "Gold Price (London Fix)",                   unit: "$/oz",    category: "cross-market" },
  SP500:                { title: "S&P 500 Index",                             unit: "Index",   category: "cross-market" },
  VIXCLS:               { title: "CBOE Volatility Index (VIX)",               unit: "Index",   category: "cross-market" },
};

// ─── Client ───────────────────────────────────────────────

/**
 * Fetch observations for a FRED series.
 * @param seriesId — e.g. "FEDFUNDS", "GDP"
 * @param limit — max observations to return (most recent first, default 10)
 */
export async function getFredSeries(seriesId: string, limit = 10): Promise<FredSeries> {
  const meta = FRED_SERIES[seriesId];
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), { next: { revalidate: 1800 } }); // 30 min cache
  if (!res.ok) {
    throw new Error(`FRED API error for ${seriesId}: ${res.status}`);
  }

  const body: FredApiResponse = await res.json();
  const observations: FredObservation[] = body.observations
    .filter((obs) => obs.value !== ".") // FRED uses "." for missing values
    .map((obs) => ({ date: obs.date, value: obs.value }));

  return {
    id: seriesId,
    title: meta?.title ?? seriesId,
    observations,
  };
}

/**
 * Get the most recent observation for a FRED series.
 * Returns null if no data is available.
 */
export async function getLatestObservation(seriesId: string): Promise<FredObservation | null> {
  const series = await getFredSeries(seriesId, 1);
  return series.observations[0] ?? null;
}
