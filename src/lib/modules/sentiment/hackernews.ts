import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchHn(params: FetchParams): Promise<unknown> {
  const query = (params.query as string) || ''
  const tag = query ? `story,${query}` : 'front_page'
  const url = `https://hn.algolia.com/api/v1/search?tags=${encodeURIComponent(tag)}&hitsPerPage=20`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`HackerNews: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'hackernews',
  name: 'HackerNews Stories',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'HackerNews Algolia — front page and topic trends (tech/social sentiment)',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchHn({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('hackernews', params, TTL.SENTIMENT, () => fetchHn(params) as Promise<T>)
  },
}
export default dataModule
