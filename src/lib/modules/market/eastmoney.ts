import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchEastMoney(_params: FetchParams): Promise<unknown> {
  const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f22,f11,f62,f128,f136,f115,f152'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`EastMoney: ${res.status}`)
  return res.json()
}

const eastMoneyModule: DataModule = {
  id: 'eastmoney',
  name: 'EastMoney',
  category: 'market',
  sourceType: 're',
  provenance: { describesItself: 'EastMoney Asian Quotes API', fragility: 'moderate', lastVerified: '2026-06-20', toleratesAbsence: true },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchEastMoney({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return { data: [] as unknown as T, source: 'eastmoney (cached)', cached: true, timestamp: Date.now(), ttl: TTL.PRICE_DATA }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('eastmoney', params, TTL.PRICE_DATA, () => fetchEastMoney(params) as Promise<T>)
  },
}
export default eastMoneyModule
