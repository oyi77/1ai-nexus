/**
 * Module: Benzinga
 * sourceType: re
 * upstreamProduct: Benzinga
 * endpoint: benzinga.com public headline endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Benzinga's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: rss-engine
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

const BASE = 'https://www.benzinga.com'

async function bzFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Benzinga ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchBenzinga(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'headlines'

  switch (action) {
    case 'headlines': {
      const channel = (params.channel as string) ?? 'crypto'
      return bzFetch<unknown>(`/api/v2/news?channel=${channel}&limit=20`)
    }
    case 'earnings':
      return bzFetch<unknown>('/api/v2/earnings?limit=20')
    default:
      throw new Error(`Benzinga: unknown action ${action}`)
  }
}

const benzingaModule: DataModule = {
  id: 'benzinga-re',
  name: 'Benzinga',
  category: 'news',
  sourceType: 're',
  provenance: {
    describesItself: 'Benzinga professional news headlines, regulatory focus',
    upstreamProduct: 'Benzinga',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await bzFetch('/api/v2/news?channel=crypto&limit=1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using RSS engine fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'benzinga-re',
      params,
      TTL.NEWS * TTL.RE_MULTIPLIER,
      () => fetchBenzinga(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    const registry = getRegistry()
    return registry.fetchOne('rss-engine', { category: 'crypto', limit: 30 }) as Promise<ModuleResult<T>>
  },
}

export default benzingaModule
