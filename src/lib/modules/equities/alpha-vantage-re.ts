/**
 * Module: Alpha Vantage
 * sourceType: re
 * upstreamProduct: Alpha Vantage
 * endpoint: alphavantage.co widget endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Alpha Vantage's internal widget API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: yahoo-finance
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

const BASE = 'https://www.alphavantage.co'

async function avFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchAlphaVantage(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'quote'

  switch (action) {
    case 'quote': {
      const symbol = (params.symbol as string) ?? 'AAPL'
      return avFetch<unknown>(`/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=demo`)
    }
    case 'ohlcv': {
      const symbol = (params.symbol as string) ?? 'AAPL'
      const interval = (params.interval as string) ?? 'daily'
      return avFetch<unknown>(`/query?function=TIME_SERIES_${interval.toUpperCase()}&symbol=${symbol}&apikey=demo`)
    }
    default:
      throw new Error(`Alpha Vantage: unknown action ${action}`)
  }
}

const alphaVantageModule: DataModule = {
  id: 'alpha-vantage-re',
  name: 'Alpha Vantage',
  category: 'equities',
  sourceType: 're',
  provenance: {
    describesItself: 'Alpha Vantage widget API — full stock OHLCV, earnings previews',
    upstreamProduct: 'Alpha Vantage',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await avFetch('/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=demo')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using Yahoo Finance fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'alpha-vantage-re',
      params,
      TTL.PRICE_DATA * TTL.RE_MULTIPLIER,
      () => fetchAlphaVantage(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const registry = getRegistry()
    const symbol = (params.symbol as string) ?? 'AAPL'
    return registry.fetchOne('yahoo-finance', { action: 'quote', symbols: symbol }) as Promise<ModuleResult<T>>
  },
}

export default alphaVantageModule
