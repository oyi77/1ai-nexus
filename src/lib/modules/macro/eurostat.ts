import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchEurostat(params: FetchParams): Promise<unknown> {
  const dataset = (params.dataset as string) || 'prc_hicp_manr'
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?format=JSON&lang=en`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`Eurostat: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'eurostat',
  name: 'Eurostat Statistics',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Eurostat SDMX API — EU macroeconomic aggregates (inflation, GDP, unemployment)',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchEurostat({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('eurostat', params, TTL.MACRO_DATA, () => fetchEurostat(params) as Promise<T>)
  },
}
export default dataModule
