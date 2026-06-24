// ─────────────────────────────────────────────────────────────
// GET /api/v1/basis — Perp vs Spot basis (Hyperdash-style)
// Shows funding rate arbitrage opportunities
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface BasisRow {
  symbol: string
  spotPrice: number
  perpPrice: number
  basis: number
  basisPercent: number
  fundingRate: number
  annualizedFunding: number
  openInterest: number
  volume24h: number
  signal: string
}

async function fetchBasisData(): Promise<BasisRow[]> {
  // Fetch futures and spot tickers from Binance
  const [futuresRes, spotRes] = await Promise.all([
    fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal: AbortSignal.timeout(15_000) }),
    fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(15_000) }),
  ])

  if (!futuresRes.ok) throw new Error(`Futures error: ${futuresRes.status}`)
  if (!spotRes.ok) throw new Error(`Spot error: ${spotRes.status}`)

  const futures = (await futuresRes.json()) as Array<{
    symbol: string
    lastPrice: string
    priceChangePercent: string
    quoteVolume: string
    openInterest?: string
  }>

  const spot = (await spotRes.json()) as Array<{
    symbol: string
    lastPrice: string
    quoteVolume: string
  }>

  // Fetch funding rates
  const fundingRes = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
    signal: AbortSignal.timeout(10_000),
  })
  const fundingData = (await fundingRes.json()) as Array<{
    symbol: string
    lastFundingRate: string
    markPrice: string
    indexPrice: string
  }>

  const spotMap = new Map(spot.map(s => [s.symbol, parseFloat(s.lastPrice)]))
  const fundingMap = new Map(fundingData.map(f => [f.symbol, {
    rate: parseFloat(f.lastFundingRate),
    mark: parseFloat(f.markPrice),
    index: parseFloat(f.indexPrice),
  }]))

  // Major USDT perpetual pairs
  const MAJOR_PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
    'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT',
    'ARBUSDT', 'OPUSDT', 'NEARUSDT', 'APTUSDT', 'SUIUSDT',
    'FILUSDT', 'ATOMUSDT', 'TRXUSDT', 'LTCUSDT',
  ]

  const rows: BasisRow[] = []

  for (const futSymbol of MAJOR_PAIRS) {
    const fut = futures.find(f => f.symbol === futSymbol)
    if (!fut) continue

    const spotSymbol = futSymbol.replace('USDT', '') + 'USDT'
    const spotPrice = spotMap.get(spotSymbol)
    if (!spotPrice || spotPrice === 0) continue

    const perpPrice = parseFloat(fut.lastPrice)
    const basis = perpPrice - spotPrice
    const basisPercent = (basis / spotPrice) * 100
    const funding = fundingMap.get(futSymbol)
    const fundingRate = funding?.rate ?? 0
    const annualizedFunding = fundingRate * 3 * 365 * 100 // 3 funding periods per day * 365 days

    // Signal
    let signal = 'Neutral'
    if (basisPercent > 0.05 && fundingRate > 0.0001) signal = 'Short Basis'
    else if (basisPercent < -0.05 && fundingRate < -0.0001) signal = 'Long Basis'
    else if (Math.abs(basisPercent) < 0.01 && Math.abs(fundingRate) < 0.00005) signal = 'Low Vol'

    rows.push({
      symbol: futSymbol.replace('USDT', ''),
      spotPrice,
      perpPrice,
      basis,
      basisPercent,
      fundingRate,
      annualizedFunding,
      openInterest: parseFloat(fut.openInterest ?? '0'),
      volume24h: parseFloat(fut.quoteVolume),
      signal,
    })
  }

  return rows.sort((a, b) => Math.abs(b.basisPercent) - Math.abs(a.basisPercent))
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('basis', 30_000, fetchBasisData)
    const resp = NextResponse.json({ data: { rows: data, count: data.length }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Basis error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch basis data' }, { status: 502 })
  }
}