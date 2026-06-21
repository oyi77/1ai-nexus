// ─────────────────────────────────────────────────────────────
// Module: ExchangeRate-API
// sourceType: public-api
// Endpoint: open.er-api.com/v6/latest
// Coverage: Live exchange rates for 160 currencies (free tier)
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://open.er-api.com/v6/latest'

async function fetchExchangeRate(params: FetchParams): Promise<unknown> {
  const base = (params.base as string) ?? 'USD'
  const res = await fetch(`${BASE}/${base}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`ExchangeRate-API ${res.status}`)
  const json = await res.json() as { result: string; base_code: string; rates: Record<string, number>; time_last_update_utc: string }
  if (json.result !== 'success') throw new Error('ExchangeRate-API: request failed')
  return { base: json.base_code, rates: json.rates, updatedAt: json.time_last_update_utc }
}

const exchangeRateModule: DataModule = {
  id: 'exchangerate-api',
  name: 'ExchangeRate-API',
  category: 'forex',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'ExchangeRate-API — live FX rates for 160 currencies, free tier',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const res = await fetch(`${BASE}/USD`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'exchangerate-api',
      params,
      TTL.MACRO_DATA,
      () => fetchExchangeRate(params) as Promise<T>,
    )
  },
}

export default exchangeRateModule
