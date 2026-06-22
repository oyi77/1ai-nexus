import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchEonet(_params: FetchParams): Promise<unknown> {
  const url = 'https://eonet.gsfc.nasa.gov/api/v3/events?limit=50&status=open'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`NASA EONET: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'nasa-eonet',
  name: 'NASA EONET Events',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Natural disaster events (wildfires, volcanoes, storms, floods) from NASA EONET',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchEonet({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('nasa-eonet', params, TTL.MACRO_DATA, () => fetchEonet(params) as Promise<T>)
  },
}
export default dataModule
