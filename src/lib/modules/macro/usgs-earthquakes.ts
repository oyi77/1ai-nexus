import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchUsgs(_params: FetchParams): Promise<unknown> {
  const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`USGS: ${res.status}`)
  return res.json()
}

const usgsModule: DataModule = {
  id: 'usgs-earthquakes',
  name: 'USGS Earthquakes',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'USGS global earthquake data feed',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await fetchUsgs({})
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('usgs-earthquakes', params, TTL.MACRO_DATA, () => fetchUsgs(params) as Promise<T>)
  },
}
export default usgsModule
