// ─────────────────────────────────────────────────────────────
// Module: GeckoTerminal
// sourceType: public-api
// Endpoint: api.geckoterminal.com/api/v2
// Coverage: DEX pools across 200+ networks, OHLCV, trending
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.geckoterminal.com/api/v2'

async function gtFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export interface TrendingPool {
  id: string
  attributes: {
    name: string
    address: string
    base_token_price_usd: string
    quote_token_price_usd: string
    volume_usd: { h24: string }
    reserve_in_usd: string
    price_change_percentage: { h24: string }
    transactions: {
      h24: { buys: number; sells: number }
    }
    pool_created_at: string
  }
  relationships: {
    network: { data: { id: string } }
    dex: { data: { id: string } }
  }
}

export interface PoolDetails {
  id: string
  attributes: {
    name: string
    address: string
    base_token_price_usd: string
    quote_token_price_usd: string
    volume_usd: { h24: string }
    reserve_in_usd: string
    price_change_percentage: { h1: string; h24: string }
    transactions: {
      m5: { buys: number; sells: number }
      h1: { buys: number; sells: number }
      h24: { buys: number; sells: number }
    }
  }
}

export interface OhlcvCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

async function fetchGeckoTerminal(params: FetchParams): Promise<unknown> {
  const network = params.network as string | undefined
  const action = (params.action as string) ?? 'trending'
  const limit = (params.limit as number) ?? 20

  if (action === 'trending') {
    const path = network
      ? `/networks/${network}/trending_pools?page=1&limit=${limit}`
      : `/networks/trending_pools?page=1&limit=${limit}`
    return gtFetch<{ data: TrendingPool[] }>(path).then(r => r.data)
  }

  if (action === 'new') {
    const path = network
      ? `/networks/${network}/new_pools?page=1&limit=${limit}`
      : `/networks/new_pools?page=1&limit=${limit}`
    return gtFetch<{ data: TrendingPool[] }>(path).then(r => r.data)
  }

  if (action === 'pool' && params.network && params.address) {
    const path = `/networks/${params.network}/pools/${params.address}`
    return gtFetch<{ data: PoolDetails }>(path).then(r => r.data)
  }

  if (action === 'ohlcv' && params.network && params.address) {
    const tf = (params.timeframe as string) ?? 'hour'
    const path = `/networks/${params.network}/pools/${params.address}/ohlcv/${tf}?limit=${limit}`
    return gtFetch<{ data: { attributes: { ohlcv_list: number[][] } } }>(path)
      .then(r => r.data.attributes.ohlcv_list.map(([t, o, h, l, c, v]: number[]) => ({
        timestamp: t, open: o, high: h, low: l, close: c, volume: v,
      })))
  }

  throw new Error(`GeckoTerminal: unknown action ${action}`)
}

const geckoterminalModule: DataModule = {
  id: 'geckoterminal',
  name: 'GeckoTerminal',
  category: 'onchain',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'GeckoTerminal DEX analytics — trending pools, new pairs, OHLCV across 200+ networks',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await gtFetch<{ data: unknown[] }>('/networks/trending_pools?page=1&limit=1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'geckoterminal',
      params,
      TTL.TOKEN_DATA,
      () => fetchGeckoTerminal(params) as Promise<T>,
    )
  },
}

export default geckoterminalModule
