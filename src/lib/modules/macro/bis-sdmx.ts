import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchBis(_params: FetchParams): Promise<unknown> {
  const url = 'https://stats.bis.org/api/v1/data/BIS,WS_EER_AVG/latest?format=jsondata'
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`BIS SDMX: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'bis-sdmx',
  name: 'BIS SDMX Data',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'BIS SDMX API — cross-border bank flows, effective exchange rates, credit aggregates',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchBis({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('bis-sdmx', params, TTL.MACRO_DATA, () => fetchBis(params) as Promise<T>)
  },
}
export default dataModule
