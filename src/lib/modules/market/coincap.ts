// ─────────────────────────────────────────────────────────────
// Module: CoinCap
// sourceType: public-api
// Endpoint: api.coincap.io/v2
// Coverage: Real-time price + WebSocket streaming
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.coincap.io/v2'

async function ccFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`CoinCap ${res.status}: ${path}`)
  const json = await res.json() as { data: T }
  return json.data
}

async function fetchCoinCap(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'assets'

  switch (action) {
    case 'assets': {
      const limit = (params.limit as number) ?? 100
      return ccFetch<unknown[]>(`/assets?limit=${limit}`)
    }
    case 'asset': {
      const id = (params.id as string) ?? 'bitcoin'
      return ccFetch<unknown>(`/assets/${id}`)
    }
    case 'markets': {
      const id = (params.id as string) ?? 'bitcoin'
      return ccFetch<unknown>(`/assets/${id}/markets?limit=20`)
    }
    case 'history': {
      const id = (params.id as string) ?? 'bitcoin'
      const interval = (params.interval as string) ?? 'h1'
      return ccFetch<unknown>(`/assets/${id}/history?interval=${interval}`)
    }
    default:
      throw new Error(`CoinCap: unknown action ${action}`)
  }
}

const coincapModule: DataModule = {
  id: 'coincap',
  name: 'CoinCap',
  category: 'market',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'CoinCap — real-time crypto prices with REST API and WebSocket streaming',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await ccFetch<unknown[]>('/assets?limit=1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'coincap',
      params,
      TTL.PRICE_DATA,
      () => fetchCoinCap(params) as Promise<T>,
    )
  },
}

export default coincapModule
