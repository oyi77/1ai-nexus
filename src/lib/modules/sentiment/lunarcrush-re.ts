/**
 * Module: LunarCrush
 * sourceType: re
 * upstreamProduct: LunarCrush
 * endpoint: lunarcrush.com dashboard endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls LunarCrush's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: reddit-sentiment + longshort-derived
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

const BASE = 'https://lunarcrush.com'

async function lcFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`LunarCrush ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchLunarCrush(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'trending'

  switch (action) {
    case 'trending':
      return lcFetch<unknown>('/api/v2/assets?sort=alt_rank&limit=20')
    case 'coin': {
      const symbol = (params.symbol as string) ?? 'BTC'
      return lcFetch<unknown>(`/api/v2/assets/${symbol}`)
    }
    case 'social': {
      const symbol = (params.symbol as string) ?? 'BTC'
      return lcFetch<unknown>(`/api/v2/assets/${symbol}/social`)
    }
    default:
      throw new Error(`LunarCrush: unknown action ${action}`)
  }
}

const lunarcrushModule: DataModule = {
  id: 'lunarcrush-re',
  name: 'LunarCrush',
  category: 'sentiment',
  sourceType: 're',
  provenance: {
    describesItself: 'LunarCrush social volume, galaxy score, social dominance per coin',
    upstreamProduct: 'LunarCrush',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await lcFetch('/api/v2/assets?limit=1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using Reddit sentiment fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'lunarcrush-re',
      params,
      TTL.SENTIMENT * TTL.RE_MULTIPLIER,
      () => fetchLunarCrush(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    const registry = getRegistry()
    return registry.fetchOne('reddit-crypto', { sub: 'all', sort: 'hot', limit: 20 }) as Promise<ModuleResult<T>>
  },
}

export default lunarcrushModule
