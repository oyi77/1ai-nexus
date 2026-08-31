// ─────────────────────────────────────────────────────────────
// Options Intelligence — Deribit Options Max Pain + Term Structure
// Plus Funding Rate Heatmap across Binance/Bybit/OKX
// All public APIs, zero API keys
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

const DERIBIT = 'https://www.deribit.com/api/v2/public'
const TIMEOUT = 10_000

// ─── Types ──────────────────────────────────────────────────

export interface MaxPainResult {
  expiry: string
  expiryTimestamp: number
  daysToExpiry: number
  maxPainStrike: number
  currentPrice: number
  distance: number            // % from current price to max pain
  signal: 'above' | 'below' | 'at'
  totalPainAtMax: number
  strikes: Array<{
    strike: number
    totalPain: number
    callPain: number
    putPain: number
  }>
}

export interface TermStructureResult {
  asset: string
  currentQuarter: { label: string; price: number } | null
  nextQuarter: { label: string; price: number } | null
  spotIndex: number
  annualizedBasis: number     // % annualized contango/backwardation
  regime: 'contango' | 'backwardation' | 'flat'
  signal: 'bullish' | 'bearish' | 'neutral'
}

export interface FundingHeatmapEntry {
  exchange: string
  symbol: string
  fundingRate: number
  annualized: number
  magnitude: 'extreme' | 'high' | 'moderate' | 'low'
  direction: 'longs_pay' | 'shorts_pay' | 'neutral'
}

export interface OptionsIntelSnapshot {
  maxPain: MaxPainResult[]
  termStructure: TermStructureResult[]
  fundingHeatmap: FundingHeatmapEntry[]
  timestamp: string
}

// ─── Deribit API types ──────────────────────────────────────

interface DeribitBookSummary {
  instrument_name: string
  mark_price: number
  open_interest: number
  volume: number
  underlying_price: number
  underlying_index: number
}

interface DeribitInstrument {
  instrument_name: string
  strike: number
  expiration_timestamp: number
  option_type: 'call' | 'put'
}

interface DeribitFutureInstrument {
  instrument_name: string
  expiration_timestamp: number
}

// ─── Deribit helpers ────────────────────────────────────────

function parseOptionName(name: string): { expiry: string; strike: number; type: 'call' | 'put' } | null {
  // BTC-27JUN26-100000-C
  const parts = name.split('-')
  if (parts.length !== 4) return null
  return { expiry: parts[1], strike: parseFloat(parts[2]), type: parts[3] === 'C' ? 'call' : 'put' }
}

async function deribitGet<T>(method: string, params: Record<string, string> = {}): Promise<T | null> {
  try {
    const qs = new URLSearchParams(params).toString()
    const url = `${DERIBIT}/${method}${qs ? `?${qs}` : ''}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return null
    const json = await res.json() as { result?: T }
    return json.result ?? null
  } catch { return null }
}

// ─── Max Pain Calculation ───────────────────────────────────

/**
 * For each expiry, compute the strike where total option holder value
 * (calls + puts) is minimized. When price gravitates toward max pain,
 * option writers (MMs) profit most.
 */
export async function fetchMaxPain(currency: 'BTC' | 'ETH' = 'BTC'): Promise<MaxPainResult[]> {
  // 1. Get index price
  const indexData = await deribitGet<{ index_price: number }>('get_index_price', {
    index_name: `${currency.toLowerCase()}_usd`,
  })
  const currentPrice = indexData?.index_price ?? 0
  if (!currentPrice) return []

  // 2. Get all active option instruments
  const instruments = await deribitGet<DeribitInstrument[]>('get_instruments', {
    currency,
    kind: 'option',
    expired: 'false',
  })
  if (!instruments?.length) return []

  // 3. Get book summary (has mark_price and open_interest for all)
  const bookSummary = await deribitGet<DeribitBookSummary[]>('get_book_summary_by_currency', {
    currency,
    kind: 'option',
  })
  if (!bookSummary?.length) return []

  // Build lookup: instrument_name -> { mark_price, open_interest }
  const bookMap = new Map<string, DeribitBookSummary>()
  for (const b of bookSummary) bookMap.set(b.instrument_name, b)

  // 4. Group instruments by expiry
  const now = Date.now()
  const expiryGroups = new Map<string, {
    timestamp: number
    instruments: DeribitInstrument[]
  }>()

  for (const inst of instruments) {
    const parsed = parseOptionName(inst.instrument_name)
    if (!parsed) continue
    if (inst.expiration_timestamp <= now) continue
    let group = expiryGroups.get(parsed.expiry)
    if (!group) {
      group = { timestamp: inst.expiration_timestamp, instruments: [] }
      expiryGroups.set(parsed.expiry, group)
    }
    group.instruments.push(inst)
  }

  // Sort by nearest expiry first, take up to 5
  const sortedExpiries = Array.from(expiryGroups.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, 5)

  const results: MaxPainResult[] = []

  for (const [expiryLabel, { timestamp: expiryTs, instruments: expInsts }] of sortedExpiries) {
    const daysToExpiry = Math.max(0, Math.ceil((expiryTs - now) / (86_400_000)))

    // Collect unique strikes
    const strikes = new Set<number>()
    for (const inst of expInsts) strikes.add(inst.strike)
    const sortedStrikes = Array.from(strikes).sort((a, b) => a - b)

    if (sortedStrikes.length === 0) continue

    // For each possible settlement strike, compute total pain
    const painByStrike: Array<{
      strike: number
      totalPain: number
      callPain: number
      putPain: number
    }> = []

    for (const settlementStrike of sortedStrikes) {
      let callPain = 0
      let putPain = 0

      for (const inst of expInsts) {
        const book = bookMap.get(inst.instrument_name)
        if (!book) continue
        const oi = book.open_interest ?? 0
        if (oi <= 0) continue
        const mark = book.mark_price ?? 0

        if (inst.option_type === 'call') {
          // Call value at settlement = max(0, settlement - strike) * OI
          const intrinsicValue = Math.max(0, settlementStrike - inst.strike) * oi
          const currentValue = mark * oi
          // Pain = current value lost (how much less the option is worth at settlement)
          callPain += Math.max(0, currentValue - intrinsicValue)
        } else {
          // Put value at settlement = max(0, strike - settlement) * OI
          const intrinsicValue = Math.max(0, inst.strike - settlementStrike) * oi
          const currentValue = mark * oi
          putPain += Math.max(0, currentValue - intrinsicValue)
        }
      }

      painByStrike.push({
        strike: settlementStrike,
        totalPain: callPain + putPain,
        callPain,
        putPain,
      })
    }

    // Max pain = strike with MINIMUM total pain (least loss for option holders = max profit for writers)
    // Actually, max pain is the strike where total option VALUE is maximized (maximum pain to holders)
    // Let me reconsider: max pain = strike where total payout to option holders is minimized
    // But the standard definition: max pain = strike that minimizes the total dollar value
    // of all outstanding options. This is where option writers profit most.
    //
    // The "pain" I computed above IS the remaining value of options.
    // Max pain = minimum remaining value = where writers profit most.
    // But conventionally "max pain" means the price level where options expire worthless.
    //
    // Let me recompute: For each settlement strike, compute total value of all options.
    // Max pain = strike where total value is MAXIMIZED (most pain to option BUYERS).
    // Wait, no. Let me look at this differently.
    //
    // Standard definition: Max pain is the strike price at which option holders
    // would lose the most money (options expire worthless or least valuable).
    // So it's the MINIMUM total intrinsic value at expiry.
    //
    // At each settlement price:
    //   total intrinsic = sum of call intrinsic * OI + put intrinsic * OI
    // Max pain = strike that MINIMIZES total intrinsic value paid out.
    //
    // I'll compute intrinsic directly instead of using mark prices.

    // Recompute with pure intrinsic values
    const intrinsicByStrike: Array<{
      strike: number
      totalPain: number
      callPain: number
      putPain: number
    }> = []

    for (const settlementStrike of sortedStrikes) {
      let callIntrinsic = 0
      let putIntrinsic = 0

      for (const inst of expInsts) {
        const book = bookMap.get(inst.instrument_name)
        if (!book) continue
        const oi = book.open_interest ?? 0
        if (oi <= 0) continue

        if (inst.option_type === 'call') {
          callIntrinsic += Math.max(0, settlementStrike - inst.strike) * oi
        } else {
          putIntrinsic += Math.max(0, inst.strike - settlementStrike) * oi
        }
      }

      intrinsicByStrike.push({
        strike: settlementStrike,
        totalPain: callIntrinsic + putIntrinsic,
        callPain: callIntrinsic,
        putPain: putIntrinsic,
      })
    }

    // Max pain = strike with maximum total intrinsic value payout
    // Actually no — max pain for option HOLDERS means the price where they lose the LEAST.
    // Max pain for option WRITERS means the price where THEY make the most.
    //
    // The standard "options max pain" = the strike price where the total value
    // of options is minimized (holders get least payout = max pain to them).
    //
    // So: find the settlement price that minimizes total intrinsic payout.
    // That's the painByStrike with MINIMUM totalPain.

    // Wait, I'm overcomplicating this. Let me just use the standard approach:
    // For each settlement price, calculate total option VALUE (intrinsic * OI).
    // Max Pain = strike where this total is MAXIMIZED.
    //
    // No wait. The "pain" in max pain is how much option HOLDERS lose.
    // If price settles at X, and the total intrinsic payout is P(X), then:
    // - Option holders paid premiums worth M total
    // - Their net loss = M - P(X)
    // - Maximum pain = maximum loss = minimum P(X)
    //
    // So max pain = argmin of total intrinsic payout.
    //
    // But many sources define max pain differently — they say it's the strike
    // where the total INTRINSIC VALUE is MAXIMIZED because that's where the
    // MOST MONEY flows to option holders. Let me just go with the most common
    // definition used by Deribit and others:
    //
    // Max Pain = the strike price at which the total value of ALL options
    // (calls + puts) is at its MAXIMUM. This is the price where maximum
    // dollars are "at stake" and where price tends to gravitate toward at expiry.
    //
    // Actually the real definition: Max Pain is the strike where the combined
    // payout to option holders is MINIMIZED (they paid premiums but get least
    // back). This is where writers (market makers) profit most.
    //
    // I'll use the second calculation (intrinsicByStrike) and find the MINIMUM.

    if (intrinsicByStrike.length === 0) continue

    const minPainEntry = intrinsicByStrike.reduce((min, entry) =>
      entry.totalPain < min.totalPain ? entry : min
    )

    const maxPainStrike = minPainEntry.strike
    const distance = ((maxPainStrike - currentPrice) / currentPrice) * 100

    results.push({
      expiry: expiryLabel,
      expiryTimestamp: expiryTs,
      daysToExpiry,
      maxPainStrike,
      currentPrice,
      distance: Math.round(distance * 100) / 100,
      signal: distance > 1 ? 'above' : distance < -1 ? 'below' : 'at',
      totalPainAtMax: minPainEntry.totalPain,
      strikes: painByStrike, // Use the mark-price based pain for the chart
    })
  }

  return results
}

// ─── Term Structure ─────────────────────────────────────────

/**
 * Compare current quarter vs next quarter futures prices.
 * Contango (next > current) = bullish (market expects higher prices).
 * Backwardation (next < current) = bearish.
 */
export async function fetchTermStructure(currency: 'BTC' | 'ETH' = 'BTC'): Promise<TermStructureResult> {
  // Get index price
  const indexData = await deribitGet<{ index_price: number }>('get_index_price', {
    index_name: `${currency.toLowerCase()}_usd`,
  })
  const spotIndex = indexData?.index_price ?? 0

  // Get all futures instruments
  const futures = await deribitGet<DeribitFutureInstrument[]>('get_instruments', {
    currency,
    kind: 'future',
    expired: 'false',
  })

  const now = Date.now()

  // Sort futures by expiration
  const sortedFutures = (futures ?? [])
    .filter(f => f.expiration_timestamp > now)
    .sort((a, b) => a.expiration_timestamp - b.expiration_timestamp)

  if (sortedFutures.length < 2) {
    return {
      asset: currency,
      currentQuarter: null,
      nextQuarter: null,
      spotIndex,
      annualizedBasis: 0,
      regime: 'flat',
      signal: 'neutral',
    }
  }

  // Current quarter = nearest, next quarter = second nearest
  const cq = sortedFutures[0]
  const nq = sortedFutures[1]

  // Fetch their mark prices via ticker
  const [cqTicker, nqTicker] = await Promise.allSettled([
    deribitGet<{ mark_price: number; instrument_name: string }>('ticker', {
      instrument_name: cq.instrument_name,
    }),
    deribitGet<{ mark_price: number; instrument_name: string }>('ticker', {
      instrument_name: nq.instrument_name,
    }),
  ])

  const cqPrice = cqTicker.status === 'fulfilled' ? cqTicker.value?.mark_price ?? 0 : 0
  const nqPrice = nqTicker.status === 'fulfilled' ? nqTicker.value?.mark_price ?? 0 : 0

  // Annualized basis for current quarter
  const daysToExpiry = Math.max(1, (cq.expiration_timestamp - now) / 86_400_000)
  const rawBasis = spotIndex > 0 ? ((cqPrice - spotIndex) / spotIndex) * 100 : 0
  const annualizedBasis = rawBasis * (365 / daysToExpiry)

  // Determine regime based on quarter-over-quarter comparison
  let regime: TermStructureResult['regime'] = 'flat'
  if (cqPrice > 0 && nqPrice > 0) {
    const diff = ((nqPrice - cqPrice) / cqPrice) * 100
    if (diff > 0.5) regime = 'contango'
    else if (diff < -0.5) regime = 'backwardation'
  } else if (annualizedBasis > 5) {
    regime = 'contango'
  } else if (annualizedBasis < -5) {
    regime = 'backwardation'
  }

  return {
    asset: currency,
    currentQuarter: cqPrice > 0 ? { label: cq.instrument_name, price: cqPrice } : null,
    nextQuarter: nqPrice > 0 ? { label: nq.instrument_name, price: nqPrice } : null,
    spotIndex,
    annualizedBasis: Math.round(annualizedBasis * 100) / 100,
    regime,
    signal: regime === 'contango' ? 'bullish' : regime === 'backwardation' ? 'bearish' : 'neutral',
  }
}

// ─── Funding Rate Heatmap ───────────────────────────────────

/**
 * Aggregate funding rates across Binance, Bybit, OKX for top pairs.
 * Color-code by magnitude and direction.
 */

interface BinanceFundingRow {
  symbol: string
  lastFundingRate: string
}

interface BybitFundingRow {
  symbol: string
  fundingRate: string
}

interface OKXFundingRow {
  instId: string
  fundingRate: string
}

async function fetchBinanceFunding(): Promise<FundingHeatmapEntry[]> {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return []
    const data = await res.json() as BinanceFundingRow[]
    return data
      .filter(d => d.symbol.endsWith('USDT'))
      .slice(0, 30)
      .map(d => {
        const rate = parseFloat(d.lastFundingRate) || 0
        return classifyFunding('Binance', d.symbol, rate)
      })
  } catch { return [] }
}

async function fetchBybitFunding(): Promise<FundingHeatmapEntry[]> {
  try {
    const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return []
    const json = await res.json() as { result?: { list?: BybitFundingRow[] } }
    return (json.result?.list ?? [])
      .filter(d => d.symbol.endsWith('USDT'))
      .slice(0, 30)
      .map(d => {
        const rate = parseFloat(d.fundingRate) || 0
        return classifyFunding('Bybit', d.symbol, rate)
      })
  } catch { return [] }
}

async function fetchOKXFunding(): Promise<FundingHeatmapEntry[]> {
  try {
    const res = await fetch('https://www.okx.com/api/v5/public/funding-rate-tickers', {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return []
    const json = await res.json() as { data?: OKXFundingRow[] }
    return (json.data ?? [])
      .filter(d => d.instId.endsWith('-USDT-SWAP'))
      .slice(0, 30)
      .map(d => {
        const rate = parseFloat(d.fundingRate) || 0
        const symbol = d.instId.replace('-USDT-SWAP', 'USDT')
        return classifyFunding('OKX', symbol, rate)
      })
  } catch { return [] }
}

function classifyFunding(exchange: string, symbol: string, rate: number): FundingHeatmapEntry {
  const absRate = Math.abs(rate)
  const annualized = rate * 3 * 365 * 100 // 8h funding * 3 per day * 365 days * 100 for %

  return {
    exchange,
    symbol,
    fundingRate: Math.round(rate * 10000) / 10000,
    annualized: Math.round(annualized * 100) / 100,
    magnitude: absRate > 0.01 ? 'extreme' : absRate > 0.005 ? 'high' : absRate > 0.001 ? 'moderate' : 'low',
    direction: rate > 0.0001 ? 'longs_pay' : rate < -0.0001 ? 'shorts_pay' : 'neutral',
  }
}

export async function fetchFundingHeatmap(): Promise<FundingHeatmapEntry[]> {
  const [binance, bybit, okx] = await Promise.allSettled([
    fetchBinanceFunding(),
    fetchBybitFunding(),
    fetchOKXFunding(),
  ])

  const all: FundingHeatmapEntry[] = [
    ...(binance.status === 'fulfilled' ? binance.value : []),
    ...(bybit.status === 'fulfilled' ? bybit.value : []),
    ...(okx.status === 'fulfilled' ? okx.value : []),
  ]

  // Sort by absolute annualized rate descending
  return all.sort((a, b) => Math.abs(b.annualized) - Math.abs(a.annualized))
}

// ─── Aggregate Snapshot ─────────────────────────────────────

export async function fetchOptionsIntelSnapshot(): Promise<OptionsIntelSnapshot> {
  const [maxPainBtc, maxPainEth, termBtc, termEth, funding] = await Promise.allSettled([
    fetchMaxPain('BTC'),
    fetchMaxPain('ETH'),
    fetchTermStructure('BTC'),
    fetchTermStructure('ETH'),
    fetchFundingHeatmap(),
  ])

  return {
    maxPain: [
      ...(maxPainBtc.status === 'fulfilled' ? maxPainBtc.value : []),
      ...(maxPainEth.status === 'fulfilled' ? maxPainEth.value : []),
    ],
    termStructure: [
      ...(termBtc.status === 'fulfilled' ? [termBtc.value] : []),
      ...(termEth.status === 'fulfilled' ? [termEth.value] : []),
    ],
    fundingHeatmap: funding.status === 'fulfilled' ? funding.value : [],
    timestamp: new Date().toISOString(),
  }
}

// ─── Persist to DB ──────────────────────────────────────────

export async function persistOptionsIntelSnapshot(snapshot: OptionsIntelSnapshot): Promise<number> {
  let count = 0

  // Persist max pain data
  for (const mp of snapshot.maxPain) {
    try {
      await prisma.derivativesIntelSnapshot.create({
        data: {
          metric: 'max_pain',
          asset: mp.expiry.startsWith('BTC') ? 'BTC' : mp.expiry.startsWith('ETH') ? 'ETH' : 'BTC',
          value: mp.maxPainStrike,
          metadata: {
            expiry: mp.expiry,
            expiryTimestamp: mp.expiryTimestamp,
            daysToExpiry: mp.daysToExpiry,
            currentPrice: mp.currentPrice,
            distance: mp.distance,
            signal: mp.signal,
            totalPainAtMax: mp.totalPainAtMax,
          },
        },
      })
      count++
    } catch { /* skip */ }
  }

  // Persist term structure data
  for (const ts of snapshot.termStructure) {
    try {
      await prisma.derivativesIntelSnapshot.create({
        data: {
          metric: 'term_structure',
          asset: ts.asset,
          value: ts.annualizedBasis,
          metadata: {
            regime: ts.regime,
            signal: ts.signal,
            spotIndex: ts.spotIndex,
            currentQuarter: ts.currentQuarter,
            nextQuarter: ts.nextQuarter,
          },
        },
      })
      count++
    } catch { /* skip */ }
  }

  // Persist aggregated funding heatmap (top entries only)
  const topFunding = snapshot.fundingHeatmap.slice(0, 20)
  for (const fh of topFunding) {
    try {
      await prisma.derivativesIntelSnapshot.create({
        data: {
          metric: 'funding_heatmap',
          asset: fh.symbol.replace('USDT', '').replace('-SWAP', ''),
          value: fh.fundingRate,
          metadata: {
            exchange: fh.exchange,
            symbol: fh.symbol,
            annualized: fh.annualized,
            magnitude: fh.magnitude,
            direction: fh.direction,
          },
        },
      })
      count++
    } catch { /* skip */ }
  }

  return count
}
