// ─────────────────────────────────────────────────────────────
// Module: Bybit Public
// sourceType: public-api
// Endpoint: api.bybit.com/v5
// Coverage: Spot + perp tickers, OHLCV, OI, funding, liquidations
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.bybit.com/v5'

async function bybitFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Bybit ${res.status}: ${path}`)
  const json = await res.json() as { retCode: number; result: T; retMsg: string }
  if (json.retCode !== 0) throw new Error(`Bybit error: ${json.retMsg}`)
  return json.result
}

async function fetchBybit(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'tickers'
  const category = (params.category as string) ?? 'spot'

  switch (action) {
    case 'tickers': {
      const symbol = params.symbol as string | undefined
      const q = symbol ? `?category=${category}&symbol=${symbol}` : `?category=${category}`
      return bybitFetch<unknown>(`/market/tickers${q}`)
    }
    case 'klines': {
      const symbol = (params.symbol as string) ?? 'BTCUSDT'
      const interval = (params.interval as string) ?? '60'
      const limit = (params.limit as number) ?? 200
      return bybitFetch<unknown>(`/market/kline?category=${category}&symbol=${symbol}&interval=${interval}&limit=${limit}`)
    }
    case 'open-interest': {
      const symbol = (params.symbol as string) ?? 'BTCUSDT'
      const intervalTime = (params.interval as string) ?? '1h'
      return bybitFetch<unknown>(`/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${intervalTime}&limit=50`)
    }
    case 'funding': {
      const symbol = (params.symbol as string) ?? 'BTCUSDT'
      return bybitFetch<unknown>(`/market/funding/history?category=linear&symbol=${symbol}&limit=100`)
    }
    case 'liquidations': {
      const symbol = params.symbol as string | undefined
      const q = symbol ? `?category=linear&symbol=${symbol}` : '?category=linear'
      return bybitFetch<unknown>(`/market/recent-trade${q}`)
    }
    default:
      throw new Error(`Bybit: unknown action ${action}`)
  }
}

const bybitModule: DataModule = {
  id: 'bybit',
  name: 'Bybit',
  category: 'market',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Bybit public API — spot + perp tickers, OHLCV, OI, funding rates, liquidations',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await bybitFetch<unknown>('/market/time')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const isDerivative = ['open-interest', 'funding', 'liquidations'].includes(params.action as string)
    return cachedFetch<T>(
      'bybit',
      params,
      isDerivative ? TTL.DERIVATIVES : TTL.PRICE_DATA,
      () => fetchBybit(params) as Promise<T>,
    )
  },
}

export default bybitModule
