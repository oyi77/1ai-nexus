// ─────────────────────────────────────────────────────────────
// Module: Frankfurter
// sourceType: public-api
// Endpoint: api.frankfurter.app
// Coverage: ECB reference FX rates, historical rates, G10 currencies
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.frankfurter.app'

async function fetchFrankfurter(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'latest'

  if (action === 'latest') {
    const from = (params.from as string) ?? 'USD'
    const to = (params.to as string) ?? 'EUR,GBP,JPY,CHF,CNY'
    const res = await fetch(`${BASE}/latest?from=${from}&to=${to}`)
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
    return res.json()
  }

  if (action === 'historical') {
    const from = (params.from as string) ?? 'USD'
    const to = (params.to as string) ?? 'EUR'
    const start = (params.start as string) ?? '2026-01-01'
    const end = (params.end as string) ?? new Date().toISOString().slice(0, 10)
    const res = await fetch(`${BASE}/${start}..${end}?from=${from}&to=${to}`)
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
    return res.json()
  }

  if (action === 'currencies') {
    const res = await fetch(`${BASE}/currencies`)
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
    return res.json()
  }

  throw new Error(`Frankfurter: unknown action ${action}`)
}

const frankfurterModule: DataModule = {
  id: 'frankfurter',
  name: 'Frankfurter',
  category: 'forex',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Frankturter — ECB reference FX rates for all G10 currencies, historical data',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const res = await fetch(`${BASE}/latest?from=USD&to=EUR`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'frankfurter',
      params,
      TTL.PRICE_DATA,
      () => fetchFrankfurter(params) as Promise<T>,
    )
  },
}

export default frankfurterModule
