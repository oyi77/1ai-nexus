/**
 * Module: Deribit Options & Derivatives
 * sourceType: public-api
 * upstreamProduct: Deribit
 * endpoint: deribit.com/api/v2/public
 * discoveredVia: docs
 * lastVerified: 2026-06-20
 * UNOFFICIAL: uses Deribit's public API (no auth needed for public endpoints)
 * fallbackFn: empty deriv data
 *
 * Alpha signals: put/call instrument ratio, underlying index price,
 * perpetual funding rate, open interest, volume — leading indicators
 * for crypto direction and volatility.
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://www.deribit.com/api/v2/public'

interface DeribitDerivData {
  btc: {
    indexPrice: number | null
    fundingRate: number | null
    openInterest: number | null
    volumeUsd: number | null
    markPrice: number | null
  }
  eth: {
    indexPrice: number | null
    fundingRate: number | null
    openInterest: number | null
    volumeUsd: number | null
    markPrice: number | null
  }
  optionInstruments: {
    btc: { puts: number; calls: number; total: number }
    eth: { puts: number; calls: number; total: number }
  }
  timestamp: number
}

async function fetchDeribit(_params: FetchParams): Promise<DeribitDerivData> {
  const result: DeribitDerivData = {
    btc: { indexPrice: null, fundingRate: null, openInterest: null, volumeUsd: null, markPrice: null },
    eth: { indexPrice: null, fundingRate: null, openInterest: null, volumeUsd: null, markPrice: null },
    optionInstruments: { btc: { puts: 0, calls: 0, total: 0 }, eth: { puts: 0, calls: 0, total: 0 } },
    timestamp: Date.now(),
  }

  // Fetch all in parallel
  await Promise.allSettled([
    // BTC index price
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_index_price?index_name=btc_usd`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000),
        })
        if (r.ok) { const j = await r.json(); result.btc.indexPrice = j.result?.index_price ?? null }
      } catch { /* skip */ }
    })(),
    // ETH index price
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_index_price?index_name=eth_usd`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000),
        })
        if (r.ok) { const j = await r.json(); result.eth.indexPrice = j.result?.index_price ?? null }
      } catch { /* skip */ }
    })(),
    // BTC book summary (mark price + volume)
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_book_summary_by_currency?currency=BTC`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000),
        })
        if (r.ok) {
          const j = await r.json()
          const perp = (j.result ?? []).find((i: Record<string, unknown>) => i.instrument_name === 'BTC-PERPETUAL')
          if (perp) {
            result.btc.markPrice = (perp.mark_price as number | undefined) ?? null
            result.btc.volumeUsd = (perp.volume_usd as number | undefined) ?? null
          }
        }
      } catch { /* skip */ }
    })(),
    // ETH book summary
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_book_summary_by_currency?currency=ETH`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000),
        })
        if (r.ok) {
          const j = await r.json()
          const perp = (j.result ?? []).find((i: Record<string, unknown>) => i.instrument_name === 'ETH-PERPETUAL')
          if (perp) {
            result.eth.markPrice = (perp.mark_price as number | undefined) ?? null
            result.eth.volumeUsd = (perp.volume_usd as number | undefined) ?? null
          }
        }
      } catch { /* skip */ }
    })(),
    // BTC perpetual ticker (funding, OI)
    (async () => {
      try {
        const r = await fetch(`${BASE}/ticker?instrument_name=BTC-PERPETUAL`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000),
        })
        if (r.ok) {
          const j = await r.json()
          result.btc.fundingRate = j.result?.current_funding ?? null
          result.btc.openInterest = j.result?.open_interest ?? null
        }
      } catch { /* skip */ }
    })(),
    // ETH perpetual ticker
    (async () => {
      try {
        const r = await fetch(`${BASE}/ticker?instrument_name=ETH-PERPETUAL`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000),
        })
        if (r.ok) {
          const j = await r.json()
          result.eth.fundingRate = j.result?.current_funding ?? null
          result.eth.openInterest = j.result?.open_interest ?? null
        }
      } catch { /* skip */ }
    })(),
    // BTC option instruments (count puts vs calls)
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_instruments?currency=BTC&kind=option&expired=false`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000),
        })
        if (r.ok) {
          const j = await r.json()
          const instruments = j.result ?? []
          result.optionInstruments.btc.total = instruments.length
          result.optionInstruments.btc.puts = instruments.filter((i: Record<string, unknown>) => i.option_type === 'put').length
          result.optionInstruments.btc.calls = instruments.filter((i: Record<string, unknown>) => i.option_type === 'call').length
        }
      } catch { /* skip */ }
    })(),
    // ETH option instruments
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_instruments?currency=ETH&kind=option&expired=false`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000),
        })
        if (r.ok) {
          const j = await r.json()
          const instruments = j.result ?? []
          result.optionInstruments.eth.total = instruments.length
          result.optionInstruments.eth.puts = instruments.filter((i: Record<string, unknown>) => i.option_type === 'put').length
          result.optionInstruments.eth.calls = instruments.filter((i: Record<string, unknown>) => i.option_type === 'call').length
        }
      } catch { /* skip */ }
    })(),
  ])

  return result
}

const deribitModule: DataModule = {
  id: 'deribit-options',
  name: 'Deribit Derivatives Data',
  category: 'derivatives',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Deribit BTC/ETH — index price, funding rate, open interest, volume, option instrument counts',
    upstreamProduct: 'Deribit',
    discoveredVia: 'docs',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const r = await fetch(`${BASE}/get_index_price?index_name=btc_usd`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000),
      })
      if (!r.ok) throw new Error(`status ${r.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('deribit-options', params, TTL.PRICE_DATA * TTL.RE_MULTIPLIER, () => fetchDeribit(params) as Promise<T>)
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: {
        btc: { indexPrice: null, fundingRate: null, openInterest: null, volumeUsd: null, markPrice: null },
        eth: { indexPrice: null, fundingRate: null, openInterest: null, volumeUsd: null, markPrice: null },
        optionInstruments: { btc: { puts: 0, calls: 0, total: 0 }, eth: { puts: 0, calls: 0, total: 0 } },
        timestamp: Date.now(),
      } as unknown as T,
      source: 'deribit (empty fallback)', cached: false, timestamp: Date.now(), ttl: TTL.PRICE_DATA,
    }
  },
}

export default deribitModule
