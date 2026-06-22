import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchAdsb(params: FetchParams): Promise<unknown> {
  const lat = (params.lat as string) || '-6.2'
  const lon = (params.lon as string) || '106.8'
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/10`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NEXUS-T/1.0' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`ADS-B: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'adsb-flight-tracking',
  name: 'ADS-B Flight Tracking',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Live ADS-B flight tracking data via adsb.lol (open, no key)',
    fragility: 'moderate',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchAdsb({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('adsb-flight-tracking', params, TTL.MACRO_DATA, () => fetchAdsb(params) as Promise<T>)
  },
}
export default dataModule
