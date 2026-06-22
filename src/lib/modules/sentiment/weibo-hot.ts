import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchWeiboHot(_params: FetchParams): Promise<unknown> {
  const url = 'https://tenapi.cn/v2/weibohot'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Weibo Hot: ${res.status}`)
  return res.json()
}

const weiboHotModule: DataModule = {
  id: 'weibo-hot',
  name: 'Weibo Hot',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: { describesItself: 'Weibo Hot Search TenAPI', fragility: 'moderate', lastVerified: '2026-06-20', toleratesAbsence: true },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchWeiboHot({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('weibo-hot', params, TTL.SENTIMENT, () => fetchWeiboHot(params) as Promise<T>)
  },
}
export default weiboHotModule
