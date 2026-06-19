/**
 * Module: Metals-API
 * sourceType: re
 * upstreamProduct: Metals-API
 * endpoint: metals-api.com dashboard endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Metals-API's internal dashboard API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: yahoo-commodities
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

async function metalsFetch<T>(path: string): Promise<T> {
  const res = await fetch(`https://metals-api.com${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Metals-API ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchMetals(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'latest'

  switch (action) {
    case 'latest':
      return metalsFetch<unknown>('/api/latest?base=USD&symbols=XAU,XAG')
    case 'historical': {
      const date = (params.date as string) ?? new Date().toISOString().slice(0, 10)
      return metalsFetch<unknown>(`/api/${date}?base=USD&symbols=XAU,XAG`)
    }
    default:
      throw new Error(`Metals-API: unknown action ${action}`)
  }
}

const metalsModule: DataModule = {
  id: 'metals-re',
  name: 'Metals-API',
  category: 'commodities',
  sourceType: 're',
  provenance: {
    describesItself: 'Metals-API spot gold and silver in multiple currencies',
    upstreamProduct: 'Metals-API',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await metalsFetch('/api/latest?base=USD&symbols=XAU')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using Yahoo Finance fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'metals-re',
      params,
      TTL.PRICE_DATA * TTL.RE_MULTIPLIER,
      () => fetchMetals(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    const registry = getRegistry()
    return registry.fetchOne('yahoo-finance', { action: 'commodities', symbols: 'GC=F,SI=F' }) as Promise<ModuleResult<T>>
  },
}

export default metalsModule
