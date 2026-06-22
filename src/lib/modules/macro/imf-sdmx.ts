import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchImf(params: FetchParams): Promise<unknown> {
  const dataset = (params.dataset as string) || 'IFS'
  const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/Dataflow/${dataset}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`IMF SDMX: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'imf-sdmx',
  name: 'IMF SDMX Data',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'IMF SDMX API — global macroeconomic data (IFS, WEO, GFS)',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchImf({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('imf-sdmx', params, TTL.MACRO_DATA, () => fetchImf(params) as Promise<T>)
  },
}
export default dataModule
