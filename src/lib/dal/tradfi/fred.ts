// ─────────────────────────────────────────────────────────────
// FRED Economic Data — DAL wrapper for registry integration
// Tier 0: free with API key (DEMO_KEY for low volume)
// §2.2 — TradFi backbone: macro-economic indicators
// ─────────────────────────────────────────────────────────────

import {
  getFredSeries,
  getLatestObservation,
  FRED_SERIES,
  type FredObservation,
  type FredSeries,
} from '@/lib/fred-client'

// ─── Re-export upstream types ──────────────────────────────

export type { FredObservation, FredSeries }

// ─── Public API ────────────────────────────────────────────

/**
 * Fetch observations for a FRED series.
 * @param seriesId — e.g. "FEDFUNDS", "GDP", "CPIAUCSL"
 * @param limit — max observations (most recent first, default 10)
 * @throws if FRED_API_KEY is not configured
 */
export async function getFredSeriesData(
  seriesId: string,
  limit = 10,
): Promise<FredSeries> {
  if (!process.env.FRED_API_KEY) {
    throw new Error(
      'FRED_API_KEY not configured. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html',
    )
  }
  return getFredSeries(seriesId, limit)
}

/**
 * Get the most recent observation for a FRED series.
 * Returns null if no data is available or key is missing.
 */
export async function getFredLatestValue(
  seriesId: string,
): Promise<FredObservation | null> {
  if (!process.env.FRED_API_KEY) return null
  return getLatestObservation(seriesId)
}

/**
 * Get all known FRED series metadata (no API call).
 */
export function getFredSeriesMeta(): Record<
  string,
  { title: string; unit: string; category: string }
> {
  return { ...FRED_SERIES }
}
