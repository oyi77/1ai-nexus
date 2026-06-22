import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchPyPI(params: FetchParams): Promise<unknown> {
  const pkg = (params.package as string) || 'numpy'
  const url = `https://pypistats.org/api/packages/${encodeURIComponent(pkg)}/recent`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`PyPI Stats: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'pypi-stats',
  name: 'PyPI Stats',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Open-source Python package download stats from pypistats.org',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchPyPI({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('pypi-stats', params, TTL.MACRO_DATA, () => fetchPyPI(params) as Promise<T>)
  },
}
export default dataModule
