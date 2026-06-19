/**
 * Module: FMP (Financial Modeling Prep)
 * sourceType: re
 * upstreamProduct: Financial Modeling Prep
 * endpoint: financialmodelingprep.com dashboard endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls FMP's internal dashboard API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: yahoo-finance + sec-edgar-rss
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'
import { getRegistry } from '../registry'

const BASE = 'https://financialmodelingprep.com'

async function fmpFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`FMP ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchFMP(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'profile'

  switch (action) {
    case 'profile': {
      const symbol = (params.symbol as string) ?? 'AAPL'
      return fmpFetch<unknown>(`/api/v3/profile/${symbol}?apikey=demo`)
    }
    case 'financials': {
      const symbol = (params.symbol as string) ?? 'AAPL'
      return fmpFetch<unknown>(`/api/v3/income-statement/${symbol}?limit=4&apikey=demo`)
    }
    case 'sec-filings': {
      const symbol = (params.symbol as string) ?? 'AAPL'
      return fmpFetch<unknown>(`/api/v3/sec_filings/${symbol}?limit=10&apikey=demo`)
    }
    default:
      throw new Error(`FMP: unknown action ${action}`)
  }
}

const fmpModule: DataModule = {
  id: 'fmp-re',
  name: 'Financial Modeling Prep',
  category: 'equities',
  sourceType: 're',
  provenance: {
    describesItself: 'FMP dashboard — financial statements, SEC filing summaries',
    upstreamProduct: 'Financial Modeling Prep',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await fmpFetch('/api/v3/profile/AAPL?apikey=demo')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using Yahoo Finance fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'fmp-re',
      params,
      TTL.PRICE_DATA * TTL.RE_MULTIPLIER,
      () => fetchFMP(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const registry = getRegistry()
    const symbol = (params.symbol as string) ?? 'AAPL'
    return registry.fetchOne('yahoo-finance', { action: 'quote', symbols: symbol }) as Promise<ModuleResult<T>>
  },
}

export default fmpModule
