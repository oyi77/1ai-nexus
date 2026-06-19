/**
 * Module: CryptoPanic
 * sourceType: re
 * upstreamProduct: CryptoPanic
 * endpoint: cryptopanic.com web feed
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls CryptoPanic's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: rss-engine (no sentiment tags)
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

const BASE = 'https://cryptopanic.com'

async function cpFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`CryptoPanic ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchCryptoPanic(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'posts'

  switch (action) {
    case 'posts': {
      const filter = (params.filter as string) ?? 'hot'
      return cpFetch<unknown>(`/api/v1/posts/?auth_token=&public=true&filter=${filter}&kind=news`)
    }
    case 'coin': {
      const symbol = (params.symbol as string) ?? 'BTC'
      const filter = (params.filter as string) ?? 'hot'
      return cpFetch<unknown>(`/api/v1/posts/?auth_token=&public=true&currencies=${symbol}&filter=${filter}`)
    }
    default:
      throw new Error(`CryptoPanic: unknown action ${action}`)
  }
}

const cryptopanicModule: DataModule = {
  id: 'cryptopanic-re',
  name: 'CryptoPanic',
  category: 'news',
  sourceType: 're',
  provenance: {
    describesItself: 'CryptoPanic curated news with bullish/bearish sentiment tags',
    upstreamProduct: 'CryptoPanic',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await cpFetch('/api/v1/posts/?auth_token=&public=true&filter=hot&kind=news')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using RSS engine fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'cryptopanic-re',
      params,
      TTL.NEWS * TTL.RE_MULTIPLIER,
      () => fetchCryptoPanic(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    const registry = getRegistry()
    return registry.fetchOne('rss-engine', { category: 'crypto', limit: 30 }) as Promise<ModuleResult<T>>
  },
}

export default cryptopanicModule
