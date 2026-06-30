// ─────────────────────────────────────────────────────────────
// GET /api/v1/arbitrage — Real-time cross-exchange arbitrage
// Spot vs Futures spread + funding rate differentials
// All from Binance (free, no API key)
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'

// Fetch top pairs dynamically from Binance API — zero hardcoded symbols

async function fetchTopPairs(count = 20): Promise<string[]> {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return ['BTC', 'ETH', 'SOL'] // minimal fallback only if API fails
  const data = await res.json() as Array<{ symbol: string; quoteVolume: string }>
  return data
    .filter(t => t.symbol.endsWith('USDT'))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, count)
    .map(t => t.symbol.replace('USDT', ''))
}

async function fetchArbitrage() {
  // Fetch top pairs dynamically from Binance by 24h volume
  const pairs = await fetchTopPairs(20)
  const symbols = pairs.map(p => `${p}USDT`)
  const [spotRes, futuresRes, fundingRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbols.map(s => `"${s}"`).join(',')}]`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=[${symbols.map(s => `"${s}"`).join(',')}]`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbols=[${symbols.map(s => `"${s}"`).join(',')}]`, { signal: AbortSignal.timeout(15_000) }),
  ])

  if (!spotRes.ok || !futuresRes.ok || !fundingRes.ok) {
    throw new Error(`Binance API error: spot=${spotRes.status} futures=${futuresRes.status} funding=${fundingRes.status}`)
  }

  const spotData = (await spotRes.json()) as Array<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }>
  const futuresData = (await futuresRes.json()) as Array<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; openInterest: string }>
  const fundingData = (await fundingRes.json()) as Array<{ symbol: string; lastFundingRate: string; nextFundingTime: string; markPrice: string; indexPrice: string }>

  const spotMap = new Map(spotData.map(s => [s.symbol, s]))
  const futuresMap = new Map(futuresData.map(f => [f.symbol, f]))
  const fundingMap = new Map(fundingData.map(f => [f.symbol, f]))

  const priceSpreads: Array<{
    symbol: string
    spotPrice: number
    futuresPrice: number
    spread: number
    spreadPercent: number
    spreadBps: number
    volume24h: number
    signal: string
  }> = []

  const fundingArbitrage: Array<{
    symbol: string
    fundingRate: number
    annualized: number
    nextFunding: string
    volume24h: number
    signal: string
  }> = []

  const spotPerpArbitrage: Array<{
    symbol: string
    spotPrice: number
    perpPrice: number
    basis: number
    basisPercent: number
    fundingRate: number
    annualizedYield: number
    signal: string
  }> = []

  for (const pair of pairs) {
    const spotSymbol = `${pair}USDT`
    const spot = spotMap.get(spotSymbol)
    const futures = futuresMap.get(spotSymbol)
    const funding = fundingMap.get(spotSymbol)

    if (!spot || !futures) continue

    const spotPrice = parseFloat(spot.lastPrice)
    const futuresPrice = parseFloat(futures.lastPrice)
    const volume = parseFloat(spot.quoteVolume)
    const fundingRate = funding ? parseFloat(funding.lastFundingRate) : 0
    const nextFunding = funding?.nextFundingTime ?? ''

    if (spotPrice === 0) continue

    // 1. Spot vs Futures spread
    const spread = futuresPrice - spotPrice
    const spreadPercent = (spread / spotPrice) * 100
    const spreadBps = spreadPercent * 100

    let spreadSignal = 'Neutral'
    if (spreadBps > 5) spreadSignal = 'Short Futures'
    else if (spreadBps < -5) spreadSignal = 'Long Futures'

    priceSpreads.push({
      symbol: pair,
      spotPrice,
      futuresPrice,
      spread,
      spreadPercent,
      spreadBps,
      volume24h: volume,
      signal: spreadSignal,
    })

    // 2. Funding rate arbitrage
    const annualized = fundingRate * 3 * 365 * 100 // 3 funding periods/day
    let fundingSignal = 'Neutral'
    if (fundingRate > 0.0003) fundingSignal = 'Short Perp'
    else if (fundingRate < -0.0003) fundingSignal = 'Long Perp'

    fundingArbitrage.push({
      symbol: pair,
      fundingRate,
      annualized,
      nextFunding,
      volume24h: volume,
      signal: fundingSignal,
    })

    // 3. Spot-Perp basis (cash-and-carry)
    const basis = futuresPrice - spotPrice
    const basisPercent = (basis / spotPrice) * 100
    const annualizedYield = basisPercent * (365 / 90) * 100 // Rough 90-day futures

    let basisSignal = 'No Edge'
    if (annualizedYield > 10) basisSignal = 'Cash & Carry'
    else if (annualizedYield < -10) basisSignal = 'Reverse Cash & Carry'

    spotPerpArbitrage.push({
      symbol: pair,
      spotPrice,
      perpPrice: futuresPrice,
      basis,
      basisPercent,
      fundingRate,
      annualizedYield,
      signal: basisSignal,
    })
  }

  const totalOpportunities = [
    ...priceSpreads.filter(s => Math.abs(s.spreadBps) > 3),
    ...fundingArbitrage.filter(f => Math.abs(f.fundingRate) > 0.0003),
    ...spotPerpArbitrage.filter(b => Math.abs(b.annualizedYield) > 10),
  ].length

  return {
    priceSpreads: priceSpreads.sort((a, b) => Math.abs(b.spreadBps) - Math.abs(a.spreadBps)),
    fundingArbitrage: fundingArbitrage.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)),
    spotPerpArbitrage: spotPerpArbitrage.sort((a, b) => Math.abs(b.annualizedYield) - Math.abs(a.annualizedYield)),
    summary: {
      totalPairs: pairs.length,
      totalOpportunities,
      avgSpreadBps: priceSpreads.reduce((s, p) => s + Math.abs(p.spreadBps), 0) / Math.max(1, priceSpreads.length),
      avgFundingRate: fundingArbitrage.reduce((s, f) => s + Math.abs(f.fundingRate), 0) / Math.max(1, fundingArbitrage.length),
    },
    timestamp: Date.now(),
  }
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('arbitrage', 10_000, fetchArbitrage)
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=20')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Arbitrage error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch arbitrage data' }, { status: 502 })
  }
}
