// ─────────────────────────────────────────────────────────────
// Module: CoinGecko
// sourceType: public-api
// Endpoint: api.coingecko.com/api/v3
// Coverage: 18,000+ coins, prices, market caps, volumes
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.coingecko.com/api/v3'

async function cgFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchCoinGecko(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'markets'

  switch (action) {
    case 'markets': {
      const vs = (params.vs_currency as string) ?? 'usd'
      const perPage = (params.per_page as number) ?? 100
      const page = (params.page as number) ?? 1
      return cgFetch<unknown[]>(
        `/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=1h,24h,7d`
      )
    }
    case 'price': {
      const ids = (params.ids as string) ?? 'bitcoin'
      const vs = (params.vs_currency as string) ?? 'usd'
      return cgFetch<unknown>(`/simple/price?ids=${ids}&vs_currency=${vs}&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`)
    }
    case 'global':
      return cgFetch<unknown>('/global')
    case 'trending':
      return cgFetch<unknown>('/search/trending')
    case 'coin': {
      const id = params.id as string
      return cgFetch<unknown>(`/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`)
    }
    default:
      throw new Error(`CoinGecko: unknown action ${action}`)
  }
}

const coingeckoModule: DataModule = {
  id: 'coingecko',
  name: 'CoinGecko',
  category: 'market',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'CoinGecko — 18,000+ coins with prices, market caps, volumes, and global data',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await cgFetch<unknown>('/ping')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'coingecko',
      params,
      TTL.PRICE_DATA,
      () => fetchCoinGecko(params) as Promise<T>,
    )
  },
}

export default coingeckoModule
