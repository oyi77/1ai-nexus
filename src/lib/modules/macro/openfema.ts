import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchOpenFema(_params: FetchParams): Promise<unknown> {
  const url = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=25&$orderby=incidentBeginDate%20desc&$format=json'
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`OpenFEMA: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'openfema',
  name: 'OpenFEMA Disasters',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'US disaster declarations & funding data from OpenFEMA',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchOpenFema({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('openfema', params, TTL.MACRO_DATA, () => fetchOpenFema(params) as Promise<T>)
  },
}
export default dataModule
