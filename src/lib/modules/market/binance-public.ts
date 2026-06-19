// ─────────────────────────────────────────────────────────────
// Module: Binance Public
// sourceType: public-api
// Endpoint: api.binance.com/api/v3, fapi.binance.com
// Coverage: Spot prices, order book, OHLCV, futures funding/OI/liquidations
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const SPOT_BASE = 'https://api.binance.com/api/v3'
const FUTURES_BASE = 'https://fapi.binance.com'

async function bnFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Binance ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

async function fetchBinance(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'ticker'

  switch (action) {
    case 'ticker': {
      const symbol = params.symbol as string | undefined
      if (symbol) return bnFetch<unknown>(`${SPOT_BASE}/ticker/24hr?symbol=${symbol}`)
      return bnFetch<unknown[]>(`${SPOT_BASE}/ticker/24hr`)
    }
    case 'price': {
      const symbols = (params.symbols as string) ?? '["BTCUSDT","ETHUSDT","SOLUSDT"]'
      return bnFetch<unknown>(`${SPOT_BASE}/ticker/price?symbols=${encodeURIComponent(symbols)}`)
    }
    case 'klines': {
      const symbol = (params.symbol as string) ?? 'BTCUSDT'
      const interval = (params.interval as string) ?? '1h'
      const limit = (params.limit as number) ?? 100
      return bnFetch<unknown[][]>(`${SPOT_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
        .then(klines => klines.map((k: unknown[]) => ({
          time: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
        })))
    }
    case 'depth': {
      const symbol = (params.symbol as string) ?? 'BTCUSDT'
      const limit = (params.limit as number) ?? 20
      return bnFetch<unknown>(`${SPOT_BASE}/depth?symbol=${symbol}&limit=${limit}`)
    }
    // Futures
    case 'funding': {
      const symbol = params.symbol as string | undefined
      const path = symbol
        ? `${FUTURES_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=100`
        : `${FUTURES_BASE}/fapi/v1/fundingRate`
      return bnFetch<unknown>(path)
    }
    case 'open-interest': {
      const symbol = (params.symbol as string) ?? 'BTCUSDT'
      return bnFetch<unknown>(`${FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`)
    }
    case 'long-short': {
      const symbol = (params.symbol as string) ?? 'BTCUSDT'
      const period = (params.period as string) ?? '1h'
      const limit = (params.limit as number) ?? 30
      return bnFetch<unknown>(
        `${FUTURES_BASE}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`
      )
    }
    case 'liquidations':
      return bnFetch<unknown>(`${FUTURES_BASE}/fapi/v1/allForceOrders?limit=100`)
    default:
      throw new Error(`Binance: unknown action ${action}`)
  }
}

const binanceModule: DataModule = {
  id: 'binance',
  name: 'Binance',
  category: 'market',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Binance public API — spot prices, order book, OHLCV, futures funding/OI/liquidations',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await bnFetch<unknown>('https://api.binance.com/api/v3/ping')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const isDerivative = ['funding', 'open-interest', 'long-short', 'liquidations'].includes(params.action as string)
    return cachedFetch<T>(
      'binance',
      params,
      isDerivative ? TTL.DERIVATIVES : TTL.PRICE_DATA,
      () => fetchBinance(params) as Promise<T>,
    )
  },
}

export default binanceModule
