import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchBoC(_params: FetchParams): Promise<unknown> {
  const url = 'https://www.bankofcanada.ca/valet/observations/group/BOC_RATE_PREV/json'
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`Bank of Canada: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'bank-of-canada',
  name: 'Bank of Canada Rates',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Bank of Canada bond yields, target interest rates, and FX rates',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchBoC({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('bank-of-canada', params, TTL.MACRO_DATA, () => fetchBoC(params) as Promise<T>)
  },
}
export default dataModule
