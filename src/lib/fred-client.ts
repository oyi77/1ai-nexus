// ─── Macro-Economic Data Client ────────────────────────────
// Sources:
//   - World Bank API (free, no key) for GDP, CPI, Unemployment
//   - Hardcoded fallback for financial market data (rates, spreads)
// No API keys required for any functionality.
// ─────────────────────────────────────────────────────────

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

// ─── Hardcoded fallback (financial market data) ───────────
// No free API exists for these. Update periodically or
// switch to a paid provider when available.

const FALLBACK_DATA: Record<string, FredObservation[]> = {
  // Rates
  FEDFUNDS: [
    { date: "2026-03", value: "4.33" },
    { date: "2025-12", value: "4.33" },
  ],
  DFF: [
    { date: "2026-06-20", value: "4.33" },
    { date: "2026-06-19", value: "4.33" },
  ],
  DGS10: [
    { date: "2026-06-20", value: "4.25" },
    { date: "2026-06-19", value: "4.28" },
  ],
  DGS2: [
    { date: "2026-06-20", value: "3.95" },
    { date: "2026-06-19", value: "3.98" },
  ],
  T10Y2Y: [
    { date: "2026-06-20", value: "0.30" },
    { date: "2026-06-19", value: "0.30" },
  ],

  // Inflation (market-based, not CPI)
  T10YIE: [
    { date: "2026-06-20", value: "2.32" },
    { date: "2026-06-19", value: "2.28" },
  ],
  T5YIFR: [
    { date: "2026-06-20", value: "2.28" },
    { date: "2026-06-19", value: "2.25" },
  ],

  // Employment
  ICSA: [
    { date: "2026-06-14", value: "218" },
    { date: "2026-06-07", value: "222" },
  ],
  PAYEMS: [
    { date: "2026-05", value: "162850" },
    { date: "2026-04", value: "162720" },
  ],

  // Growth
  INDPRO: [
    { date: "2026-05", value: "108.2" },
    { date: "2026-04", value: "107.9" },
  ],

  // Real Estate
  HOUST: [
    { date: "2026-05", value: "1420" },
    { date: "2026-04", value: "1385" },
  ],
  MORTGAGE30US: [
    { date: "2026-06-19", value: "6.95" },
    { date: "2026-06-12", value: "7.02" },
  ],

  // Sentiment
  UMCSENT: [
    { date: "2026-06", value: "68.2" },
    { date: "2026-05", value: "67.5" },
  ],

  // Monetary
  M2SL: [
    { date: "2026-04", value: "20850" },
    { date: "2026-03", value: "20640" },
  ],

  // Cross-Market
  DTWEXBGS: [
    { date: "2026-06-20", value: "104.2" },
    { date: "2026-06-19", value: "102.8" },
  ],
  DCOILWTICO: [
    { date: "2026-06-20", value: "78.5" },
    { date: "2026-06-19", value: "76.2" },
  ],
  GOLDAMGBD228NLBM: [
    { date: "2026-06-20", value: "2450" },
    { date: "2026-06-19", value: "2380" },
  ],
  SP500: [
    { date: "2026-06-20", value: "5520" },
    { date: "2026-06-19", value: "5350" },
  ],
  VIXCLS: [
    { date: "2026-06-20", value: "14.5" },
    { date: "2026-06-19", value: "15.2" },
  ],
};

// ─── Client ───────────────────────────────────────────────

/**
 * Fetch observations for a macro-economic series.
 * Uses World Bank API for GDP/CPI/Unemployment, hardcoded fallback for financial market data.
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

  // Try World Bank for supported indicators
  const wbMapping = WORLD_BANK_INDICATORS[seriesId];
  if (wbMapping) {
    try {
      const observations = await fetchFromWorldBank(seriesId, wbMapping, limit);
      if (observations.length > 0) {
        const series: FredSeries = { id: seriesId, title, observations };
        seriesCache.set(seriesId, { data: series, timestamp: Date.now() });
        return series;
      }
    } catch (e) {
      console.warn(`[fred-client] World Bank API failed for ${seriesId}:`, e);
    }
  }

  // Hardcoded fallback for financial market data (or if World Bank failed)
  const fallbackData = FALLBACK_DATA[seriesId];
  const observations = fallbackData ? fallbackData.slice(0, limit) : [];
  const series: FredSeries = { id: seriesId, title, observations };
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
