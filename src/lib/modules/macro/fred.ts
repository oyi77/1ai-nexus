// ─────────────────────────────────────────────────────────────
// Module: FRED (Federal Reserve Economic Data)
// sourceType: public-api
// Endpoint: api.stlouisfed.org/fred
// Coverage: Fed rates, CPI, GDP, unemployment, M2, treasury yields
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.stlouisfed.org/fred/series/observations'

export const FRED_SERIES: Record<string, { title: string; unit: string; category: string }> = {
  FEDFUNDS:  { title: 'Federal Funds Effective Rate',              unit: '%',     category: 'rates' },
  DGS10:     { title: '10-Year Treasury Constant Maturity Rate',   unit: '%',     category: 'rates' },
  DGS2:      { title: '2-Year Treasury Constant Maturity Rate',    unit: '%',     category: 'rates' },
  T10Y2Y:    { title: '10Y-2Y Treasury Spread',                   unit: '%',     category: 'rates' },
  CPIAUCSL:  { title: 'Consumer Price Index',                     unit: 'Index', category: 'inflation' },
  UNRATE:    { title: 'Unemployment Rate',                         unit: '%',     category: 'employment' },
  GDP:       { title: 'Gross Domestic Product',                    unit: 'B$',    category: 'gdp' },
  M2SL:      { title: 'M2 Money Supply',                           unit: 'B$',    category: 'money' },
  DXY:       { title: 'Trade Weighted U.S. Dollar Index',          unit: 'Index', category: 'currency' },
  VIXCLS:    { title: 'CBOE Volatility Index',                    unit: 'Index', category: 'volatility' },
}

async function fetchFred(params: FetchParams): Promise<unknown> {
  const seriesId = (params.series as string) ?? 'FEDFUNDS'
  const limit = (params.limit as number) ?? 30

  // Use DEMO_KEY for free access (rate-limited but works for low volume)
  const url = `${BASE}?series_id=${seriesId}&api_key=DEMO_KEY&file_type=json&sort_order=desc&limit=${limit}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`FRED ${res.status}: ${seriesId}`)
  const json = await res.json() as { observations: Array<{ date: string; value: string }> }

  return {
    seriesId,
    meta: FRED_SERIES[seriesId],
    observations: json.observations
      .filter(o => o.value !== '.')
      .map(o => ({ date: o.date, value: Number(o.value) })),
  }
}

const fredModule: DataModule = {
  id: 'fred',
  name: 'FRED',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Federal Reserve Economic Data — rates, CPI, GDP, unemployment, M2, treasury yields',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const url = `${BASE}?series_id=FEDFUNDS&api_key=DEMO_KEY&file_type=json&limit=1`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'fred',
      params,
      TTL.MACRO_DATA,
      () => fetchFred(params) as Promise<T>,
    )
  },
}

export default fredModule
