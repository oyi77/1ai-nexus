import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

async function fetchWeather(params: FetchParams): Promise<unknown> {
  const lat = (params.lat as string) || '-6.2146'
  const lon = (params.lon as string) || '106.8451'
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`+
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,pressure_msl`+
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code`+
    `&timezone=auto&forecast_days=3`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)
  return res.json()
}

const dataModule: DataModule = {
  id: 'open-meteo',
  name: 'Open-Meteo Weather',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Global hyper-local weather forecasts via Open-Meteo (free, no key)',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try { await fetchWeather({}); return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } }
    catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('open-meteo', params, TTL.MACRO_DATA, () => fetchWeather(params) as Promise<T>)
  },
}
export default dataModule
