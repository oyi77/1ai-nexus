import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchReliefWeb(_params: FetchParams): Promise<unknown> {
  const url = 'https://api.reliefweb.int/v1/reports?appname=nexus-terminal&limit=20&preset=latest&slim=1'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`ReliefWeb: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'reliefweb',
  name: 'ReliefWeb Humanitarian',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Global humanitarian & conflict updates via ReliefWeb (UN OCHA)',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchReliefWeb({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('reliefweb', params, TTL.MACRO_DATA, () => fetchReliefWeb(params) as Promise<T>)
  },
}
export default dataModule
