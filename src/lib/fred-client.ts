// ─── Macro-Economic Data Client ────────────────────────────
// Sources:
//   - World Bank API (free, no key) for GDP, CPI, Unemployment
// No API keys required. Returns empty if live data unavailable.
// ─────────────────────────────────────────────────────────


const FRED_API_BASE = 'https://api.stlouisfed.org/fred/series/observations'

function isFredObservations(value: unknown): value is Array<{ date: string; value: string }> {
  if (!Array.isArray(value)) return false
  return value.every(item =>
    item &&
    typeof item === 'object' &&
    'date' in item &&
    typeof (item as Record<string, unknown>).date === 'string' &&
    'value' in item &&
    typeof (item as Record<string, unknown>).value === 'string'
  )
}

function isFredResponse(value: unknown): value is { observations: Array<{ date: string; value: string }> } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'observations' in value &&
    isFredObservations((value as Record<string, unknown>).observations)
  )
}
const WORLD_BANK_BASE = "https://api.worldbank.org/v2";

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

// ─── Key FRED Series (metadata preserved for callers) ─────

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

// ─── World Bank indicator mappings ────────────────────────

const WORLD_BANK_INDICATORS: Record<string, { indicator: string; transform: (val: number) => string }> = {
  GDP:      { indicator: "NY.GDP.MKTP.CD", transform: (v) => (v / 1e9).toFixed(1) },
  CPIAUCSL: { indicator: "FP.CPI.TOTL",    transform: (v) => v.toFixed(2) },
  UNRATE:   { indicator: "SL.UEM.TOTL.ZS", transform: (v) => v.toFixed(1) },
};

// ─── Cache ────────────────────────────────────────────────

interface CacheEntry {
  data: FredSeries;
  timestamp: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const seriesCache = new Map<string, CacheEntry>();

// ─── World Bank fetcher ───────────────────────────────────

interface WorldBankObservation {
  date: string;
  value: number | null;
}

function isWorldBankResponse(json: unknown): json is [unknown, WorldBankObservation[]] {
  return Array.isArray(json) && json.length === 2 && Array.isArray(json[1]);
}

async function fetchFromWorldBank(
  seriesId: string,
  mapping: { indicator: string; transform: (val: number) => string },
  limit: number,
): Promise<FredObservation[]> {
  const url = `${WORLD_BANK_BASE}/country/us/indicator/${mapping.indicator}?format=json&per_page=${Math.max(limit * 2, 20)}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`World Bank API ${res.status} for ${seriesId}`);

  const json: unknown = await res.json();
  if (!isWorldBankResponse(json)) throw new Error(`Unexpected World Bank response for ${seriesId}`);

  return json[1]
    .filter((obs) => obs.value !== null)
    .slice(0, limit)
    .map((obs) => ({
      date: obs.date,
      value: mapping.transform(obs.value as number),
    }));
}

// ─── Client ───────────────────────────────────────────────

/**
 * Fetch observations for a macro-economic series.
 * Uses World Bank API for GDP/CPI/Unemployment. Returns empty if unavailable.
 * @param seriesId — e.g. "FEDFUNDS", "GDP"
 * @param limit — max observations to return (most recent first, default 10)
 */
export async function getFredSeries(seriesId: string, limit = 10): Promise<FredSeries> {
  // Check cache
  const cached = seriesCache.get(seriesId);
  if (cached && Date.now() - cached.timestamp <= CACHE_TTL_MS) {
    return { ...cached.data, observations: cached.data.observations.slice(0, limit) };
  }

  const meta = FRED_SERIES[seriesId];
  const title = meta?.title ?? seriesId;

  // Try real FRED API with DEMO_KEY (rate-limited but works for low volume)
  try {
    const url = `${FRED_API_BASE}?series_id=${seriesId}&api_key=DEMO_KEY&file_type=json&sort_order=desc&limit=${limit}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (res.ok) {
      const raw: unknown = await res.json()
      if (isFredResponse(raw)) {
        const observations: FredObservation[] = raw.observations
          .filter(o => o.value !== '.')
          .map(o => ({ date: o.date, value: o.value }))
        if (observations.length > 0) {
          const series: FredSeries = { id: seriesId, title, observations }
          seriesCache.set(seriesId, { data: series, timestamp: Date.now() })
          return series
        }
      }
    }
  } catch {
    console.warn(`[fred-client] FRED API failed for ${seriesId}, trying World Bank fallback`)
  }

  // Fallback: World Bank for GDP/CPI/Unemployment indicators
  const wbMapping = WORLD_BANK_INDICATORS[seriesId];
  if (wbMapping) {
    try {
      const observations = await fetchFromWorldBank(seriesId, wbMapping, limit);
      if (observations.length > 0) {
        const series: FredSeries = { id: seriesId, title, observations };
        seriesCache.set(seriesId, { data: series, timestamp: Date.now() });
        return series;
      }
    } catch {
      console.warn(`[fred-client] World Bank API failed for ${seriesId}`)
    }
  }

  // No data available
  const series: FredSeries = { id: seriesId, title, observations: [] };
  seriesCache.set(seriesId, { data: series, timestamp: Date.now() });
  return series;
}

/**
 * Get the most recent observation for a series.
 * Returns null if no data is available.
 */
export async function getLatestObservation(seriesId: string): Promise<FredObservation | null> {
  const series = await getFredSeries(seriesId, 1);
  return series.observations[0] ?? null;
}
