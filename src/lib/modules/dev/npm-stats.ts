import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchNPM(params: FetchParams): Promise<unknown> {
  const pkg = (params.package as string) || 'next'
  const url = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`NPM Stats: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'npm-stats',
  name: 'NPM Stats',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'JavaScript ecosystem package download stats from npmjs.org API',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchNPM({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('npm-stats', params, TTL.MACRO_DATA, () => fetchNPM(params) as Promise<T>)
  },
}
export default dataModule
