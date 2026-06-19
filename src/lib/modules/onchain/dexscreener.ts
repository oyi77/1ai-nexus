// ─────────────────────────────────────────────────────────────
// Module: DexScreener
// sourceType: public-api
// Endpoint: api.dexscreener.com
// Coverage: Token pair analytics, trending, new pairs, search (300 req/min)
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.dexscreener.com'

async function dsFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`DexScreener ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchDexScreener(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'trending'

  switch (action) {
    case 'trending':
      return dsFetch<unknown>('/token-boosts/latest/v1')
    case 'search': {
      const q = params.q as string
      return dsFetch<unknown>(`/latest/dex/search/?q=${encodeURIComponent(q)}`)
    }
    case 'token': {
      const chainId = params.chain as string ?? 'solana'
      const address = params.address as string
      return dsFetch<unknown>(`/tokens/v1/${chainId}/${address}`)
    }
    case 'pairs': {
      const chainId = params.chain as string ?? 'solana'
      const pairAddress = params.address as string
      return dsFetch<unknown>(`/latest/dex/pairs/${chainId}/${pairAddress}`)
    }
    case 'new':
      return dsFetch<unknown>('/token-profiles/latest/v1')
    default:
      throw new Error(`DexScreener: unknown action ${action}`)
  }
}

const dexscreenerModule: DataModule = {
  id: 'dexscreener',
  name: 'DexScreener',
  category: 'onchain',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'DexScreener — token pair analytics, trending tokens, new pairs across all chains',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await dsFetch<unknown>('/token-boosts/latest/v1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'dexscreener',
      params,
      TTL.TOKEN_DATA,
      () => fetchDexScreener(params) as Promise<T>,
    )
  },
}

export default dexscreenerModule
