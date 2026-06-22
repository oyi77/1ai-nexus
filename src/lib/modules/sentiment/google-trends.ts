import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchGoogleTrends(_params: FetchParams): Promise<unknown> {
  const url = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Google Trends: ${res.status}`)
  const xml = await res.text()
  return { xml }
}

const googleTrendsModule: DataModule = {
  id: 'google-trends',
  name: 'Google Trends',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: { describesItself: 'Google Trends Daily RSS', fragility: 'moderate', lastVerified: '2026-06-20', toleratesAbsence: true },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchGoogleTrends({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('google-trends', params, TTL.SENTIMENT, () => fetchGoogleTrends(params) as Promise<T>)
  },
}
export default googleTrendsModule
