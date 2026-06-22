import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchUkOns(_params: FetchParams): Promise<unknown> {
  const url = 'https://api.beta.ons.gov.uk/v1/datasets?limit=10&sort=release_date&q=inflation+GDP+unemployment'
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`UK ONS: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'uk-ons',
  name: 'UK ONS Statistics',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'UK inflation, GDP, unemployment, and treasury yield data from ONS API',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchUkOns({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('uk-ons', params, TTL.MACRO_DATA, () => fetchUkOns(params) as Promise<T>)
  },
}
export default dataModule
