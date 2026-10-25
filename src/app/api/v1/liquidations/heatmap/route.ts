// ─────────────────────────────────────────────────────────────
// GET /api/v1/liquidations/heatmap — Real-time liquidation heatmap
// Uses Binance public liquidation feed (no API key needed)
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
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

  const unavailableReasons: string[] = []
  if (!(currentPrice > 0) || !(markPrice > 0)) unavailableReasons.push('Binance mark/index price unavailable')

  let liquidations: LiquidationEvent[] = []
  if (!liqRes.ok) {
    unavailableReasons.push(`Binance forced-liquidation source returned HTTP ${liqRes.status}`)
  } else {
    const raw = (await liqRes.json()) as Array<{
      symbol: string
      side: string
      price: string
      origQty: string
      time: number
    }>
    liquidations = raw.map((liq): LiquidationEvent => ({
      symbol: liq.symbol,
      side: liq.side === 'BUY' ? 'short' as const : 'long' as const,
      price: parseFloat(liq.price),
      quantity: parseFloat(liq.origQty),
      usdValue: parseFloat(liq.price) * parseFloat(liq.origQty),
      timestamp: liq.time,
    })).filter(liq => Number.isFinite(liq.price) && liq.price > 0 && Number.isFinite(liq.quantity) && liq.quantity > 0)
  }

  const oiRes = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${binanceSymbol}`, {
    signal: AbortSignal.timeout(10_000),
  })

  let openInterest: number | null = null
  if (oiRes.ok) {
    const oi = (await oiRes.json()) as { openInterest: string }
    const value = parseFloat(oi.openInterest)
    if (Number.isFinite(value)) openInterest = value
  }
  if (openInterest == null) unavailableReasons.push('Binance open interest unavailable')

  const bins: HeatmapBin[] = []
  const eventPrices = liquidations.map(liq => liq.price)
  const startPrice = eventPrices.length > 0 ? Math.min(...eventPrices) : 0
  const endPrice = eventPrices.length > 0 ? Math.max(...eventPrices) : 0
  const binSize = eventPrices.length > 1 ? Math.max((endPrice - startPrice) / 40, Number.EPSILON) : 0

  for (const liq of liquidations) {
    const binIdx = binSize > 0 ? Math.min(39, Math.floor((liq.price - startPrice) / binSize)) : 0
    let bin = bins[binIdx]
    if (!bin) {
      bin = { priceLevel: binSize > 0 ? startPrice + binIdx * binSize : liq.price, density: 0, longLiquidations: 0, shortLiquidations: 0, totalUsd: 0 }
      bins[binIdx] = bin
    }
    if (liq.side === 'long') bin.longLiquidations += liq.quantity
    else bin.shortLiquidations += liq.quantity
    bin.totalUsd += liq.usdValue
  }
  const actualBins = bins.filter(Boolean)
  const maxTotal = Math.max(...actualBins.map(bin => bin.totalUsd), 1)
  for (const bin of actualBins) bin.density = bin.totalUsd / maxTotal


  const clusters = actualBins
    .filter(b => b.density > 0.5)
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 5)
    .map(b => ({
      priceLevel: b.priceLevel,
      usdValue: b.totalUsd,
      side: b.longLiquidations > b.shortLiquidations ? 'long' : 'short',
      distance: currentPrice > 0 ? ((b.priceLevel - currentPrice) / currentPrice * 100).toFixed(2) : null,
    }))

  return {
    symbol,
    currentPrice: currentPrice > 0 ? currentPrice : null,
    markPrice: markPrice > 0 ? markPrice : null,
    fundingRate: Number.isFinite(fundingRate) ? fundingRate : null,
    openInterest,
    heatmap: actualBins,
    clusters,
    recentLiquidations: liquidations.slice(0, 20).map(l => ({
      ...l,
      usdFormatted: l.usdValue >= 1e6 ? `$${(l.usdValue / 1e6).toFixed(2)}M` : `$${(l.usdValue / 1e3).toFixed(0)}K`,
    })),
    range: { start: startPrice, end: endPrice, binSize },
    unavailableReason: unavailableReasons.length > 0 ? unavailableReasons.join('; ') : null,
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