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
 *
 * Actions:
 *   (default)       — aggregate derivatives data (funding, OI, put/call counts)
 *   options-chain   — full options chain with bid/ask, IV, Greeks, OI per strike
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://www.deribit.com/api/v2/public'

// ─── Types ────────────────────────────────────────────────

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

export interface OptionContract {
  instrument: string
  strike: number
  expiry: number           // unix ms
  expiryLabel: string
  optionType: 'call' | 'put'
  bid: number
  ask: number
  mark: number
  markIv: number           // implied volatility %
  bidIv: number
  askIv: number
  delta: number
  gamma: number
  theta: number
  vega: number
  rho: number
  openInterest: number
  volume: number
  underlyingPrice: number
}

export interface OptionsChainData {
  currency: 'BTC' | 'ETH'
  indexPrice: number
  expiries: Array<{
    label: string
    timestamp: number
    daysToExpiry: number
    calls: OptionContract[]
    puts: OptionContract[]
  }>
  atmIv: number | null
  putCallRatio: number
  totalOI: number
  timestamp: number
}

// ─── Aggregate derivatives fetch ──────────────────────────

async function fetchDeribit(_params: FetchParams): Promise<DeribitDerivData> {
  const result: DeribitDerivData = {
    btc: { indexPrice: null, fundingRate: null, openInterest: null, volumeUsd: null, markPrice: null },
    eth: { indexPrice: null, fundingRate: null, openInterest: null, volumeUsd: null, markPrice: null },
    optionInstruments: { btc: { puts: 0, calls: 0, total: 0 }, eth: { puts: 0, calls: 0, total: 0 } },
    timestamp: Date.now(),
  }

  await Promise.allSettled([
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_index_price?index_name=btc_usd`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
        if (r.ok) { const j = await r.json(); result.btc.indexPrice = j.result?.index_price ?? null }
      } catch { /* skip */ }
    })(),
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_index_price?index_name=eth_usd`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
        if (r.ok) { const j = await r.json(); result.eth.indexPrice = j.result?.index_price ?? null }
      } catch { /* skip */ }
    })(),
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_book_summary_by_currency?currency=BTC`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
        if (r.ok) {
          const j = await r.json()
          const perp = (j.result ?? []).find((i: Record<string, unknown>) => i.instrument_name === 'BTC-PERPETUAL')
          if (perp) { result.btc.markPrice = (perp.mark_price as number | undefined) ?? null; result.btc.volumeUsd = (perp.volume_usd as number | undefined) ?? null }
        }
      } catch { /* skip */ }
    })(),
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_book_summary_by_currency?currency=ETH`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
        if (r.ok) {
          const j = await r.json()
          const perp = (j.result ?? []).find((i: Record<string, unknown>) => i.instrument_name === 'ETH-PERPETUAL')
          if (perp) { result.eth.markPrice = (perp.mark_price as number | undefined) ?? null; result.eth.volumeUsd = (perp.volume_usd as number | undefined) ?? null }
        }
      } catch { /* skip */ }
    })(),
    (async () => {
      try {
        const r = await fetch(`${BASE}/ticker?instrument_name=BTC-PERPETUAL`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
        if (r.ok) { const j = await r.json(); result.btc.fundingRate = j.result?.current_funding ?? null; result.btc.openInterest = j.result?.open_interest ?? null }
      } catch { /* skip */ }
    })(),
    (async () => {
      try {
        const r = await fetch(`${BASE}/ticker?instrument_name=ETH-PERPETUAL`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
        if (r.ok) { const j = await r.json(); result.eth.fundingRate = j.result?.current_funding ?? null; result.eth.openInterest = j.result?.open_interest ?? null }
      } catch { /* skip */ }
    })(),
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_instruments?currency=BTC&kind=option&expired=false`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
        if (r.ok) {
          const j = await r.json()
          const instruments = j.result ?? []
          result.optionInstruments.btc.total = instruments.length
          result.optionInstruments.btc.puts = instruments.filter((i: Record<string, unknown>) => i.option_type === 'put').length
          result.optionInstruments.btc.calls = instruments.filter((i: Record<string, unknown>) => i.option_type === 'call').length
        }
      } catch { /* skip */ }
    })(),
    (async () => {
      try {
        const r = await fetch(`${BASE}/get_instruments?currency=ETH&kind=option&expired=false`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
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

// ─── Options chain fetch ──────────────────────────────────

interface DeribitInstrument {
  instrument_name: string
  strike: number
  expiration_timestamp: number
  option_type: 'call' | 'put'
}

interface DeribitTicker {
  instrument_name: string
  mark_price: number
  best_bid_price: number
  best_ask_price: number
  mark_iv: number
  bid_iv: number
  ask_iv: number
  greeks?: { delta: number; gamma: number; theta: number; vega: number; rho: number }
  open_interest: number
  volume: number
  underlying_price: number
}

function parseInstrumentName(name: string): { expiry: string; strike: number; type: 'call' | 'put' } | null {
  // Format: BTC-27JUN26-100000-C
  const parts = name.split('-')
  if (parts.length !== 4) return null
  return { expiry: parts[1], strike: parseFloat(parts[2]), type: parts[3] === 'C' ? 'call' : 'put' }
}

async function fetchOptionsChain(params: FetchParams): Promise<OptionsChainData> {
  const currency = ((params.currency as string) ?? 'BTC').toUpperCase() as 'BTC' | 'ETH'

  // Step 1: Get index price
  let indexPrice = 0
  try {
    const r = await fetch(`${BASE}/get_index_price?index_name=${currency.toLowerCase()}_usd`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
    if (r.ok) { const j = await r.json(); indexPrice = j.result?.index_price ?? 0 }
  } catch { /* skip */ }

  // Step 2: Get all instruments
  let instruments: DeribitInstrument[] = []
  try {
    const r = await fetch(`${BASE}/get_instruments?currency=${currency}&kind=option&expired=false`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
    if (r.ok) { const j = await r.json(); instruments = (j.result ?? []) as DeribitInstrument[] }
  } catch { /* skip */ }

  // Step 3: Group by expiry, pick next 3 nearest
  const now = Date.now()
  const expiryMap = new Map<string, { timestamp: number; instruments: DeribitInstrument[] }>()
  for (const inst of instruments) {
    const parsed = parseInstrumentName(inst.instrument_name)
    if (!parsed) continue
    let entry = expiryMap.get(parsed.expiry)
    if (!entry) { entry = { timestamp: inst.expiration_timestamp, instruments: [] }; expiryMap.set(parsed.expiry, entry) }
    entry.instruments.push(inst)
  }

  const sortedExpiries = Array.from(expiryMap.entries())
    .filter(([, e]) => e.timestamp > now)
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, 3)

  // Step 4: For each expiry, fetch tickers for ~20 strikes around ATM
  const chainExpiries: OptionsChainData['expiries'] = []
  let totalOI = 0
  let totalCalls = 0
  let totalPuts = 0
  let atmIv: number | null = null

  for (const [label, { timestamp, instruments: expInstruments }] of sortedExpiries) {
    const daysToExpiry = Math.max(0, Math.ceil((timestamp - now) / (24 * 60 * 60 * 1000)))

    // Pick ~20 strikes closest to ATM
    const nearest = expInstruments
      .sort((a, b) => Math.abs(a.strike - indexPrice) - Math.abs(b.strike - indexPrice))
      .slice(0, 20)

    const calls: OptionContract[] = []
    const puts: OptionContract[] = []

    await Promise.allSettled(
      nearest.map(async (inst) => {
        try {
          const r = await fetch(`${BASE}/ticker?instrument_name=${inst.instrument_name}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
          if (!r.ok) return
          const j = await r.json()
          const t = j.result as DeribitTicker

          const contract: OptionContract = {
            instrument: inst.instrument_name,
            strike: inst.strike,
            expiry: timestamp,
            expiryLabel: label,
            optionType: inst.option_type,
            bid: t.best_bid_price ?? 0,
            ask: t.best_ask_price ?? 0,
            mark: t.mark_price ?? 0,
            markIv: t.mark_iv ?? 0,
            bidIv: t.bid_iv ?? 0,
            askIv: t.ask_iv ?? 0,
            delta: t.greeks?.delta ?? 0,
            gamma: t.greeks?.gamma ?? 0,
            theta: t.greeks?.theta ?? 0,
            vega: t.greeks?.vega ?? 0,
            rho: t.greeks?.rho ?? 0,
            openInterest: t.open_interest ?? 0,
            volume: t.volume ?? 0,
            underlyingPrice: t.underlying_price ?? indexPrice,
          }

          totalOI += contract.openInterest
          if (inst.option_type === 'call') { totalCalls++; calls.push(contract) }
          else { totalPuts++; puts.push(contract) }

          // Track ATM IV
          if (inst.option_type === 'call' && (atmIv === null || Math.abs(inst.strike - indexPrice) < 500)) {
            atmIv = contract.markIv
          }
        } catch { /* skip */ }
      }),
    )

    calls.sort((a, b) => a.strike - b.strike)
    puts.sort((a, b) => a.strike - b.strike)
    chainExpiries.push({ label, timestamp, daysToExpiry, calls, puts })
  }

  return { currency, indexPrice, expiries: chainExpiries, atmIv, putCallRatio: totalCalls > 0 ? totalPuts / totalCalls : 0, totalOI, timestamp: Date.now() }
}

// ─── Module ───────────────────────────────────────────────

const deribitModule: DataModule = {
  id: 'deribit-options',
  name: 'Deribit Derivatives Data',
  category: 'derivatives',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Deribit — BTC/ETH options and perpetuals data',
    fragility: 'moderate',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const r = await fetch(`${BASE}/test`, { signal: AbortSignal.timeout(5_000) })
      if (r.ok) return { status: 'active', lastChecked: new Date(), failureCount: 0, notes: 'Deribit API reachable' }
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: `HTTP ${r.status}` }
    } catch (e) { return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) } }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const action = (params.action as string) ?? 'default'
    const cacheKey = action === 'options-chain' ? `deribit-chain-${params.currency ?? 'BTC'}` : 'deribit-options'
    const ttl = action === 'options-chain' ? TTL.PRICE_DATA : TTL.PRICE_DATA * TTL.RE_MULTIPLIER

    return cachedFetch<T>(cacheKey, params, ttl, () => {
      if (action === 'options-chain') return fetchOptionsChain(params) as Promise<T>
      return fetchDeribit(params) as Promise<T>
    })
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
