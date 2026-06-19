/**
 * Module: Birdeye
 * sourceType: re
 * upstreamProduct: Birdeye
 * endpoint: birdeye.so dashboard endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Birdeye's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: geckoterminal + jupiter
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

const BASE = 'https://public-api.birdeye.so'

async function birdeyeFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Birdeye ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchBirdeye(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'trending'

  switch (action) {
    case 'trending':
      return birdeyeFetch<unknown>('/defi/token_trending?sort_by=volume24hUSD&sort_type=desc&offset=0&limit=20')
    case 'token': {
      const address = params.address as string
      return birdeyeFetch<unknown>(`/defi/token_overview?address=${address}`)
    }
    case 'new':
      return birdeyeFetch<unknown>('/defi/token_new_listing?limit=20')
    default:
      throw new Error(`Birdeye: unknown action ${action}`)
  }
}

const birdeyeModule: DataModule = {
  id: 'birdeye-re',
  name: 'Birdeye',
  category: 'onchain',
  sourceType: 're',
  provenance: {
    describesItself: 'Birdeye SOL token analytics — holder distribution, smart money %, trade history',
    upstreamProduct: 'Birdeye',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await birdeyeFetch('/defi/token_trending?limit=1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'May need GeckoTerminal fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'birdeye-re',
      params,
      TTL.TOKEN_DATA * TTL.RE_MULTIPLIER,
      () => fetchBirdeye(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    const registry = getRegistry()
    return registry.fetchOne('geckoterminal', { action: 'trending', limit: 20 }) as Promise<ModuleResult<T>>
  },
}

export default birdeyeModule
