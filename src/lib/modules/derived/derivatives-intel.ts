// ─────────────────────────────────────────────────────────────
// Derivatives Intelligence Module
// Tracks funding rates, open interest, long/short ratios across
// Binance, Bybit, OKX — all public REST endpoints, zero API keys
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

interface ExchangeFundingRate {
  exchange: string
  symbol: string
  fundingRate: number
  nextFundingTime: number
  markPrice: number
  indexPrice: number
}

interface ExchangeOpenInterest {
  exchange: string
  symbol: string
  openInterest: number
  openInterestUsd: number
}

interface LongShortRatio {
  exchange: string
  symbol: string
  longAccount: number
  shortAccount: number
  longShortRatio: number
}

// ─── Binance ───────────────────────────────────────────────

async function fetchBinanceFunding(): Promise<ExchangeFundingRate[]> {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as Array<{ symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string; nextFundingTime: number }>
    return data
      .filter(d => d.symbol.endsWith('USDT'))
      .slice(0, 50)
      .map(d => ({
        exchange: 'Binance',
        symbol: d.symbol,
        fundingRate: parseFloat(d.lastFundingRate) || 0,
        nextFundingTime: d.nextFundingTime,
        markPrice: parseFloat(d.markPrice) || 0,
        indexPrice: parseFloat(d.indexPrice) || 0,
      }))
  } catch { return [] }
}

async function fetchBinanceOI(): Promise<ExchangeOpenInterest[]> {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/openInterest', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as Array<{ symbol: string; openInterest: string }>
    return data
      .filter(d => d.symbol.endsWith('USDT'))
      .slice(0, 50)
      .map(d => ({
        exchange: 'Binance',
        symbol: d.symbol,
        openInterest: parseFloat(d.openInterest) || 0,
        openInterestUsd: 0,
      }))
  } catch { return [] }
}

async function fetchBinanceLongShort(): Promise<LongShortRatio[]> {
  try {
    const res = await fetch('https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as Array<{ longAccount: string; shortAccount: string; longShortRatio: string }>
    return data.map(d => ({
      exchange: 'Binance',
      symbol: 'BTCUSDT',
      longAccount: parseFloat(d.longAccount) || 0,
      shortAccount: parseFloat(d.shortAccount) || 0,
      longShortRatio: parseFloat(d.longShortRatio) || 0,
    }))
  } catch { return [] }
}

// ─── Bybit ─────────────────────────────────────────────────

async function fetchBybitFunding(): Promise<ExchangeFundingRate[]> {
  try {
    const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as { result?: { list?: Array<{ symbol: string; fundingRate: string; nextFundingTime: number; markPrice: string; indexPrice: string }> } }
    return (data.result?.list ?? [])
      .filter(d => d.symbol.endsWith('USDT'))
      .slice(0, 50)
      .map(d => ({
        exchange: 'Bybit',
        symbol: d.symbol,
        fundingRate: parseFloat(d.fundingRate) || 0,
        nextFundingTime: d.nextFundingTime,
        markPrice: parseFloat(d.markPrice) || 0,
        indexPrice: parseFloat(d.indexPrice) || 0,
      }))
  } catch { return [] }
}

async function fetchBybitOI(): Promise<ExchangeOpenInterest[]> {
  try {
    const res = await fetch('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&interval=1h&limit=1', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as { result?: { list?: Array<{ openInterest: string }> } }
    return (data.result?.list ?? []).map(d => ({
      exchange: 'Bybit',
      symbol: 'BTCUSDT',
      openInterest: parseFloat(d.openInterest) || 0,
      openInterestUsd: 0,
    }))
  } catch { return [] }
}

// ─── OKX ───────────────────────────────────────────────────

async function fetchOKXFunding(): Promise<ExchangeFundingRate[]> {
  try {
    const res = await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as { data?: Array<{ fundingRate: string; nextFundingTime: number; markPx: string; indexPx: string }> }
    return (data.data ?? []).map(d => ({
      exchange: 'OKX',
      symbol: 'BTC-USDT-SWAP',
      fundingRate: parseFloat(d.fundingRate) || 0,
      nextFundingTime: d.nextFundingTime,
      markPrice: parseFloat(d.markPx) || 0,
      indexPrice: parseFloat(d.indexPx) || 0,
    }))
  } catch { return [] }
}

// ─── Aggregate ─────────────────────────────────────────────

export interface DerivativesSnapshot {
  exchange: string
  symbol: string
  fundingRate: number
  openInterest: number
  longShortRatio: number | null
  markPrice: number | null
  indexPrice: number | null
  timestamp: string
}

export async function fetchDerivativesSnapshot(): Promise<DerivativesSnapshot[]> {
  const [binanceFunding, binanceOI, binanceLSR, bybitFunding, bybitOI, okxFunding] = await Promise.allSettled([
    fetchBinanceFunding(),
    fetchBinanceOI(),
    fetchBinanceLongShort(),
    fetchBybitFunding(),
    fetchBybitOI(),
    fetchOKXFunding(),
  ])

  // Build OI lookup
  const oiMap = new Map<string, number>()
  if (binanceOI.status === 'fulfilled') {
    for (const d of binanceOI.value) oiMap.set(`Binance:${d.symbol}`, d.openInterest)
  }
  if (bybitOI.status === 'fulfilled') {
    for (const d of bybitOI.value) oiMap.set(`Bybit:${d.symbol}`, d.openInterest)
  }

  // Build LSR lookup
  const lsrMap = new Map<string, number>()
  if (binanceLSR.status === 'fulfilled') {
    for (const d of binanceLSR.value) lsrMap.set(`${d.exchange}:${d.symbol}`, d.longShortRatio)
  }

  const results: DerivativesSnapshot[] = []
  const allFunding = [
    ...(binanceFunding.status === 'fulfilled' ? binanceFunding.value : []),
    ...(bybitFunding.status === 'fulfilled' ? bybitFunding.value : []),
    ...(okxFunding.status === 'fulfilled' ? okxFunding.value : []),
  ]

  for (const f of allFunding) {
    results.push({
      exchange: f.exchange,
      symbol: f.symbol,
      fundingRate: f.fundingRate,
      openInterest: oiMap.get(`${f.exchange}:${f.symbol}`) ?? 0,
      longShortRatio: lsrMap.get(`${f.exchange}:${f.symbol}`) ?? null,
      markPrice: f.markPrice,
      indexPrice: f.indexPrice,
      timestamp: new Date().toISOString(),
    })
  }

  return results.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate))
}

// ─── Persist to DB ─────────────────────────────────────────

export async function persistDerivativesSnapshot(snapshots: DerivativesSnapshot[]): Promise<number> {
  let count = 0
  for (const s of snapshots) {
    try {
      await prisma.derivativesSnapshot.create({
        data: {
          exchange: s.exchange,
          symbol: s.symbol,
          fundingRate: s.fundingRate,
          openInterest: s.openInterest,
          longShortRatio: s.longShortRatio,
          markPrice: s.markPrice,
          indexPrice: s.indexPrice,
        },
      })
      count++
    } catch { /* skip duplicates */ }
  }
  return count
}

// ─── Liquidation feed ──────────────────────────────────────

interface Liquidation {
  exchange: string
  symbol: string
  side: 'Buy' | 'Sell'
  quantity: number
  price: number
  estimatedValueUsd: number
  timestamp: string
}

export async function fetchRecentLiquidations(): Promise<Liquidation[]> {
  // Binance public liquidation endpoint
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/allForceOrders?limit=50', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as Array<{ symbol: string; side: string; forceQuantity: string; price: number; time: number }>
    return data.map(d => ({
      exchange: 'Binance',
      symbol: d.symbol,
      side: d.side as 'Buy' | 'Sell',
      quantity: parseFloat(d.forceQuantity) || 0,
      price: d.price,
      estimatedValueUsd: (parseFloat(d.forceQuantity) || 0) * d.price,
      timestamp: new Date(d.time).toISOString(),
    }))
  } catch { return [] }
}

export async function persistLiquidations(liqs: Liquidation[]): Promise<number> {
  let count = 0
  for (const l of liqs) {
    try {
      await prisma.liquidationEvent.create({
        data: {
          exchange: l.exchange,
          symbol: l.symbol,
          side: l.side,
          quantity: l.quantity,
          price: l.price,
          estimatedValueUsd: l.estimatedValueUsd,
          timestamp: new Date(l.timestamp),
        },
      })
      count++
    } catch { /* skip */ }
  }
  return count
}
