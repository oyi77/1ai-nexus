// ─────────────────────────────────────────────────────────────
// Module: FRED (Federal Reserve Economic Data)
// sourceType: public-api
// Endpoint: api.stlouisfed.org/fred + Treasury CSV + World Bank
// Coverage: Fed rates, CPI, GDP, unemployment, treasury yields
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getFredSeries, FRED_SERIES as SHARED_SERIES } from '@/lib/fred-client'

export const FRED_SERIES: Record<string, { title: string; unit: string; category: string }> = {
  ...SHARED_SERIES,
}

async function fetchFred(params: FetchParams): Promise<unknown> {
  const seriesId = (params.series as string) ?? 'FEDFUNDS'
  const limit = (params.limit as number) ?? 30

  const result = await getFredSeries(seriesId, limit)
  return {
    seriesId,
    meta: FRED_SERIES[seriesId],
    observations: result.observations.map(o => ({
      date: o.date,
      value: o.value === '' ? null : Number(o.value),
    })),
  }
}

const fredModule: DataModule = {
  id: 'fred',
  name: 'FRED',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Federal Reserve Economic Data — rates, CPI, GDP, unemployment, M2, treasury yields. Uses Treasury CSV (free) + World Bank (free) + FRED API (with key).',
    fragility: 'stable',
    lastVerified: '2026-06-30',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const result = await getFredSeries('DGS10', 1)
      if (result.observations.length > 0) {
        return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
      }
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Treasury CSV returned no data' }
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
