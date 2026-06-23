// ─────────────────────────────────────────────────────────────
// FRED Economic Data — DAL wrapper for registry integration
// Tier 0: free, no API key required (World Bank + fallback)
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
 * Uses World Bank API (free) for GDP/CPI/Unemployment,
 * hardcoded fallback for financial market data.
 * @param seriesId — e.g. "FEDFUNDS", "GDP", "CPIAUCSL"
 * @param limit — max observations (most recent first, default 10)
 */
export async function getFredSeriesData(
  seriesId: string,
  limit = 10,
): Promise<FredSeries> {
  return getFredSeries(seriesId, limit)
}

/**
 * Get the most recent observation for a FRED series.
 * Returns null if no data is available.
 */
export async function getFredLatestValue(
  seriesId: string,
): Promise<FredObservation | null> {
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
