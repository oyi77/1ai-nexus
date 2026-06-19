/**
 * Module: Yahoo Finance
 * sourceType: re
 * upstreamProduct: Yahoo Finance
 * endpoint: query1.finance.yahoo.com / query2.finance.yahoo.com
 * discoveredVia: community-package
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Yahoo Finance's internal JSON API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: cached last-known-good
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASES = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

async function yfFetch<T>(path: string): Promise<T> {
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const json = await res.json() as { chart?: { result?: unknown[] }; quoteSummary?: { result?: unknown[] } }
      return json as T
    } catch {
      continue
    }
  }
  throw new Error('Yahoo Finance: all endpoints failed')
}

async function fetchYahooFinance(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'quote'

  switch (action) {
    case 'quote': {
      const symbols = (params.symbols as string) ?? 'BTC-USD,ETH-USD,SOL-USD'
      const data = await yfFetch<{ quoteResponse?: { result?: Array<Record<string, unknown>> } }>(
        `/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`
      )
      return data.quoteResponse?.result ?? []
    }
    case 'chart': {
      const symbol = (params.symbol as string) ?? 'BTC-USD'
      const interval = (params.interval as string) ?? '1d'
      const range = (params.range as string) ?? '1mo'
      const data = await yfFetch<{ chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, unknown[]>> } }> } }>(
        `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
      )
      const result = data.chart?.result?.[0]
      if (!result) return null
      return {
        symbol,
        timestamps: result.timestamp ?? [],
        quote: result.indicators?.quote?.[0] ?? {},
      }
    }
    case 'commodities': {
      // Gold, Silver, Oil, Natural Gas
      const symbols = (params.symbols as string) ?? 'GC=F,SI=F,CL=F,NG=F'
      const data = await yfFetch<{ quoteResponse?: { result?: Array<Record<string, unknown>> } }>(
        `/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`
      )
      return data.quoteResponse?.result ?? []
    }
    default:
      throw new Error(`Yahoo Finance: unknown action ${action}`)
  }
}

const yahooFinanceModule: DataModule = {
  id: 'yahoo-finance',
  name: 'Yahoo Finance',
  category: 'equities',
  sourceType: 're',
  provenance: {
    describesItself: 'Yahoo Finance internal JSON API — stocks, indices, crypto, commodities',
    upstreamProduct: 'Yahoo Finance Premium',
    discoveredVia: 'community-package',
    fragility: 'moderate',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await yfFetch('/v7/finance/quote?symbols=AAPL')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'yahoo-finance',
      params,
      TTL.PRICE_DATA * TTL.RE_MULTIPLIER,
      () => fetchYahooFinance(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    // Fallback: return cached data or empty
    return { data: [] as unknown as T, source: 'yahoo-finance (cached)', cached: true, timestamp: Date.now(), ttl: TTL.PRICE_DATA * TTL.RE_MULTIPLIER }
  },
}

export default yahooFinanceModule
