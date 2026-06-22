import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchZhihuTrends(_params: FetchParams): Promise<unknown> {
  const url = 'https://tenapi.cn/v2/zhihuhot'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Zhihu Trends: ${res.status}`)
  return res.json()
}

const zhihuTrendsModule: DataModule = {
  id: 'zhihu-trends',
  name: 'Zhihu Trends',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: { describesItself: 'Zhihu Hot Search TenAPI', fragility: 'moderate', lastVerified: '2026-06-20', toleratesAbsence: true },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchZhihuTrends({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('zhihu-trends', params, TTL.SENTIMENT, () => fetchZhihuTrends(params) as Promise<T>)
  },
}
export default zhihuTrendsModule
