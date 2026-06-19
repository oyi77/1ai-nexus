// ─────────────────────────────────────────────────────────────
// Module: CoinPaprika
// sourceType: public-api
// Endpoint: api.coinpaprika.com
// Coverage: 50,000+ assets, market caps, volumes, exchange data, OHLC
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.coinpaprika.com/v1'

async function cpFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`CoinPaprika ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchCoinPaprika(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'tickers'

  switch (action) {
    case 'tickers': {
      const limit = (params.limit as number) ?? 100
      return cpFetch<unknown[]>(`/tickers?limit=${limit}`)
    }
    case 'ticker': {
      const id = (params.id as string) ?? 'btc-bitcoin'
      return cpFetch<unknown>(`/tickers/${id}`)
    }
    case 'global':
      return cpFetch<unknown>('/global')
    case 'coins':
      return cpFetch<unknown[]>('/coins')
    case 'ohlc': {
      const id = (params.id as string) ?? 'btc-bitcoin'
      const days = (params.days as number) ?? 7
      return cpFetch<unknown>(`/coins/${id}/ohlcv/latest?days=${days}`)
    }
    default:
      throw new Error(`CoinPaprika: unknown action ${action}`)
  }
}

const coinpaprikaModule: DataModule = {
  id: 'coinpaprika',
  name: 'CoinPaprika',
  category: 'market',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'CoinPaprika — 50,000+ assets with market caps, volumes, exchange data, OHLC history',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await cpFetch<unknown>('/global')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'coinpaprika',
      params,
      TTL.PRICE_DATA,
      () => fetchCoinPaprika(params) as Promise<T>,
    )
  },
}

export default coinpaprikaModule
