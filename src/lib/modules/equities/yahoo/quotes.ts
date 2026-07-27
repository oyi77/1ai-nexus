/**
 * Module: Yahoo Finance
 * sourceType: re
 * upstreamProduct: Yahoo Finance
 * endpoint: query1.finance.yahoo.com / query2.finance.yahoo.com
 * discoveredVia: community-package
 * lastVerified: 2026-07-27
 * UNOFFICIAL: this calls Yahoo Finance's internal JSON API, not their public API.
 *   Uses /v8/finance/chart for quotes (v7 quote returns empty from server IPs).
 *   fallbackFn: cached last-known-good
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import { cachedFetch } from '../../fetch-with-cache'

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
      const json = await res.json() as T
      return json as T
    } catch {
      continue
    }
  }
  throw new Error('Yahoo Finance: all endpoints failed')
}

/** Fetch a single quote via chart endpoint (v7 quote returns empty from server IPs) */
async function chartQuote(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await yfFetch<{ chart?: { result?: Array<{ meta?: Record<string, unknown> }> } }>(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
    )
    const meta = data.chart?.result?.[0]?.meta
    if (!meta) return null
    const price = meta.regularMarketPrice as number | undefined
    const prevClose = meta.chartPreviousClose as number | undefined
    const change = price != null && prevClose != null ? price - prevClose : 0
    const changePercent = prevClose != null && prevClose !== 0 ? (change / prevClose) * 100 : 0
    return {
      symbol: meta.symbol ?? symbol,
      regularMarketPrice: price,
      regularMarketChange: change,
      regularMarketChangePercent: changePercent,
      chartPreviousClose: prevClose,
      currency: meta.currency ?? 'USD',
      marketState: meta.marketState ?? 'REGULAR',
      shortName: meta.shortName ?? symbol,
    }
  } catch { return null }
}

async function fetchYahooFinance(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'quote'

  switch (action) {
    case 'quote': {
      const symbols = (params.symbols as string) ?? 'BTC-USD,ETH-USD,SOL-USD'
      // Chart endpoint is more reliable from server IPs; fetch each symbol individually
      const list = symbols.split(',').map(s => s.trim()).filter(Boolean)
      const results = await Promise.allSettled(list.map(s => chartQuote(s)))
      const quotes = results
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<Record<string, unknown>>).value)
      return quotes
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
      const list = symbols.split(',').map(s => s.trim()).filter(Boolean)
      const results = await Promise.allSettled(list.map(s => chartQuote(s)))
      const quotes = results
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<Record<string, unknown>>).value)
      return quotes
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
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const q = await chartQuote('AAPL')
      if (!q) throw new Error('empty quote')
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
    return { data: [] as unknown as T, source: 'yahoo-finance (cached)', cached: true, timestamp: Date.now(), ttl: TTL.PRICE_DATA * TTL.RE_MULTIPLIER }
  },
}

export default yahooFinanceModule
