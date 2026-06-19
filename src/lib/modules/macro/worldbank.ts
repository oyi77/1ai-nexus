// ─────────────────────────────────────────────────────────────
// Module: World Bank
// sourceType: public-api
// Endpoint: api.worldbank.org/v2
// Coverage: GDP, inflation, global economic indicators by country
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.worldbank.org/v2'

async function fetchWorldBank(params: FetchParams): Promise<unknown> {
  const indicator = (params.indicator as string) ?? 'NY.GDP.MKTP.CD' // GDP current USD
  const country = (params.country as string) ?? 'US'
  const limit = (params.limit as number) ?? 10

  const url = `${BASE}/country/${country}/indicator/${indicator}?format=json&per_page=${limit}&date=2020:2026`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`World Bank ${res.status}`)
  const json = await res.json() as Array<unknown>
  const data = Array.isArray(json[1]) ? json[1] : []
  return data.map((d: Record<string, unknown>) => ({
    country: (d.country as Record<string, string>)?.value,
    indicator: (d.indicator as Record<string, string>)?.value,
    date: d.date,
    value: d.value,
  }))
}

const worldBankModule: DataModule = {
  id: 'worldbank',
  name: 'World Bank',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'World Bank — GDP, inflation, global economic indicators by country',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const res = await fetch(`${BASE}/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=1`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'worldbank',
      params,
      TTL.MACRO_DATA,
      () => fetchWorldBank(params) as Promise<T>,
    )
  },
}

export default worldBankModule
