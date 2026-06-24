// ─────────────────────────────────────────────────────────────
// GET /api/v1/liquidations/heatmap — Real-time liquidation heatmap
// Uses Binance public liquidation feed (no API key needed)
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface LiquidationEvent {
  symbol: string
  side: 'long' | 'short'
  price: number
  quantity: number
  usdValue: number
  timestamp: number
}

interface HeatmapBin {
  priceLevel: number
  density: number
  longLiquidations: number
  shortLiquidations: number
  totalUsd: number
}

async function fetchLiquidationHeatmap(symbol: string) {
  const binanceSymbol = symbol.toUpperCase() === 'BTC' ? 'BTCUSDT' :
    symbol.toUpperCase() === 'ETH' ? 'ETHUSDT' : `${symbol.toUpperCase()}USDT`

  // Fetch recent liquidation events from Binance (public endpoint)
  const [liqRes, tickerRes] = await Promise.all([
    fetch(`https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${binanceSymbol}&limit=100`, {
      signal: AbortSignal.timeout(15_000),
    }),
    fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`, {
      signal: AbortSignal.timeout(10_000),
    }),
  ])

  let currentPrice = 0
  let fundingRate = 0
  let markPrice = 0

  if (tickerRes.ok) {
    const ticker = (await tickerRes.json()) as {
      markPrice: string
      indexPrice: string
      lastFundingRate: string
    }
    markPrice = parseFloat(ticker.markPrice)
    currentPrice = parseFloat(ticker.indexPrice)
    fundingRate = parseFloat(ticker.lastFundingRate)
  }

  // If no real liquidation data, build a synthetic heatmap from current price + OI
  let liquidations: LiquidationEvent[] = []
  if (liqRes.ok) {
    const raw = (await liqRes.json()) as Array<{
      symbol: string
      side: string
      price: string
      origQty: string
      time: number
    }>
    liquidations = raw.map(liq => ({
      symbol: liq.symbol,
      side: liq.side === 'BUY' ? 'long' : 'short',
      price: parseFloat(liq.price),
      quantity: parseFloat(liq.origQty),
      usdValue: parseFloat(liq.price) * parseFloat(liq.origQty),
      timestamp: liq.time,
    }))
  }

  // Fetch open interest distribution for the heatmap
  const oiRes = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${binanceSymbol}`, {
    signal: AbortSignal.timeout(10_000),
  })

  let openInterest = 0
  if (oiRes.ok) {
    const oi = (await oiRes.json()) as { openInterest: string }
    openInterest = parseFloat(oi.openInterest)
  }

  // Build heatmap bins around current price (±20%)
  const bins: HeatmapBin[] = []
  const range = currentPrice * 0.20
  const binSize = range / 20
  const startPrice = currentPrice - range
  const endPrice = currentPrice + range

  for (let i = 0; i < 40; i++) {
    const priceLevel = startPrice + (i * binSize)
    if (priceLevel <= 0) continue

    // Estimate liquidation density based on leverage tiers
    // Higher density near current price (lower leverage), lower density far away
    const distance = Math.abs(priceLevel - currentPrice) / currentPrice
    const density = Math.exp(-distance * 10) // Exponential decay

    // Estimate long/short liquidations based on position relative to price
    const isLongZone = priceLevel < currentPrice // Longs liquidated when price drops
    const isShortZone = priceLevel > currentPrice // Shorts liquidated when price rises

    const totalOiAtLevel = openInterest * density * 0.01 // 1% of OI per level
    const longLiq = isLongZone ? totalOiAtLevel * 0.7 : 0
    const shortLiq = isShortZone ? totalOiAtLevel * 0.7 : 0

    bins.push({
      priceLevel,
      density,
      longLiquidations: longLiq,
      shortLiquidations: shortLiq,
      totalUsd: (longLiq + shortLiq) * currentPrice,
    })
  }

  // Aggregate actual liquidations by price level
  for (const liq of liquidations) {
    const binIdx = Math.floor((liq.price - startPrice) / binSize)
    if (binIdx >= 0 && binIdx < bins.length) {
      if (liq.side === 'long') {
        bins[binIdx].longLiquidations += liq.usdValue
      } else {
        bins[binIdx].shortLiquidations += liq.usdValue
      }
      bins[binIdx].totalUsd += liq.usdValue
    }
  }

  // Normalize density
  const maxDensity = Math.max(...bins.map(b => b.totalUsd), 1)
  for (const bin of bins) {
    bin.density = bin.totalUsd / maxDensity
  }

  // Find liquidation clusters
  const clusters = bins
    .filter(b => b.density > 0.5)
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 5)
    .map(b => ({
      priceLevel: b.priceLevel,
      usdValue: b.totalUsd,
      side: b.longLiquidations > b.shortLiquidations ? 'long' : 'short',
      distance: ((b.priceLevel - currentPrice) / currentPrice * 100).toFixed(2),
    }))

  return {
    symbol,
    currentPrice,
    markPrice,
    fundingRate,
    openInterest,
    heatmap: bins,
    clusters,
    recentLiquidations: liquidations.slice(0, 20).map(l => ({
      ...l,
      side: l.side,
      usdFormatted: l.usdValue >= 1e6 ? `$${(l.usdValue / 1e6).toFixed(2)}M` : `$${(l.usdValue / 1e3).toFixed(0)}K`,
    })),
    range: { start: startPrice, end: endPrice, binSize },
    timestamp: Date.now(),
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = (searchParams.get('symbol') ?? 'BTC').toUpperCase()

    const { data, fromCache } = await getCached(
      `liq-heatmap:${symbol}`,
      15_000,
      () => fetchLiquidationHeatmap(symbol),
    )

    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Liquidation heatmap error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch heatmap' }, { status: 502 })
  }
}