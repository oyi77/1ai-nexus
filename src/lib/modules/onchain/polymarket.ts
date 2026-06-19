// ─────────────────────────────────────────────────────────────
// Module: Polymarket
// sourceType: public-api
// Endpoint: clob.polymarket.com
// Coverage: All active markets, order books, odds, volume, resolution history
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://clob.polymarket.com'

async function pmFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Polymarket ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchPolymarket(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'markets'

  switch (action) {
    case 'markets':
      return pmFetch<unknown>('/markets?limit=100&active=true')
    case 'market': {
      const id = params.id as string
      return pmFetch<unknown>(`/markets/${id}`)
    }
    case 'book': {
      const token = params.token as string
      return pmFetch<unknown>(`/book?token_id=${token}`)
    }
    default:
      throw new Error(`Polymarket: unknown action ${action}`)
  }
}

const polymarketModule: DataModule = {
  id: 'polymarket',
  name: 'Polymarket',
  category: 'prediction',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Polymarket CLOB — prediction markets, order books, odds, volume',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await pmFetch<unknown>('/markets?limit=1&active=true')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'polymarket',
      params,
      TTL.PREDICTION,
      () => fetchPolymarket(params) as Promise<T>,
    )
  },
}

export default polymarketModule
