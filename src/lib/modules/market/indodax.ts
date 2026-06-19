// ─────────────────────────────────────────────────────────────
// Module: Indodax
// sourceType: public-api
// Endpoint: indodax.com
// Coverage: Indonesia crypto exchange — IDR pairs, tickers, order book — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://indodax.com/api'

async function indodaxFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Indodax ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchIndodax(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'tickers'

  switch (action) {
    case 'tickers':
      return indodaxFetch<unknown>('/v2/tickers')
    case 'ticker': {
      const pair = (params.pair as string) ?? 'btc_idr'
      return indodaxFetch<unknown>(`/v2/ticker/${pair}`)
    }
    case 'pairs':
      return indodaxFetch<unknown>('/v2/pairs')
    default:
      throw new Error(`Indodax: unknown action ${action}`)
  }
}

const indodaxModule: DataModule = {
  id: 'indodax',
  name: 'Indodax',
  category: 'market',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Indodax — Indonesia crypto exchange with IDR-denominated pairs, tickers, order book',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await indodaxFetch('/v2/tickers')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('indodax', params, TTL.PRICE_DATA, () => fetchIndodax(params) as Promise<T>)
  },
}

export default indodaxModule
