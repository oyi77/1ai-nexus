import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchGdacs(_params: FetchParams): Promise<unknown> {
  const url = 'https://gdacs.org/xml/rss.xml'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`GDACS: ${res.status}`)
  const xml = await res.text()
  return { xml }
}

const gdacsModule: DataModule = {
  id: 'gdacs-alerts',
  name: 'GDACS Alerts',
  category: 'macro',
  sourceType: 'public-api',
  provenance: { describesItself: 'Global Disaster Alert and Coordination System', fragility: 'stable', lastVerified: '2026-06-20', toleratesAbsence: true },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchGdacs({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('gdacs-alerts', params, TTL.MACRO_DATA, () => fetchGdacs(params) as Promise<T>)
  },
}
export default gdacsModule
