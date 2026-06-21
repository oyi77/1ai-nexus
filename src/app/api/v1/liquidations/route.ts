// ─────────────────────────────────────────────────────────────
// GET /api/v1/liquidations — Liquidation heatmap data
// Aggregates Hyperliquid market data, computes estimated
// liquidation zones by leverage tier, and returns heatmap bins.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  getHyperliquidMarkets,
  getHyperliquidFundingRates,
  getHyperliquidLeaderboard,
} from '@/lib/modules/onchain/hyperliquid-dex'

interface HeatmapBin {
  priceLevel: number
  density: number        // normalised 0–1
  longLiquidations: number
  shortLiquidations: number
  symbol: string
}

interface LiquidationLevel {
  price: number
  leverage: number
  side: 'long' | 'short'
  estimatedSize: number
}

interface MarketLiq {
  symbol: string
  price: number
  markPrice: number
  openInterest: number
  fundingRate: number
  maxLeverage: number
  priceChange24h: number
  liquidationLevels: LiquidationLevel[]
  heatmapBins: HeatmapBin[]
}

// Standard leverage tiers to estimate liquidation zones
const LEVERAGE_TIERS = [2, 3, 5, 10, 20, 50, 75, 100]

function computeLiquidationLevels(
  price: number,
  _openInterest: number,
  maxLeverage: number,
  _symbol: string,
): LiquidationLevel[] {
  const levels: LiquidationLevel[] = []
  const tiers = LEVERAGE_TIERS.filter(t => t <= maxLeverage || maxLeverage === 0)

  // Estimate OI distribution: heavier at lower leverage, exponential decay
  const totalWeight = tiers.reduce((s, t) => s + 1 / t, 0)

  for (const lev of tiers) {
    const weight = (1 / lev) / totalWeight
    // Maintenance margin ~ 0.5% for most perps
    const mm = 0.005
    // Long liq = price * (1 - 1/lev + mm)
    const longLiq = price * (1 - 1 / lev + mm)
    // Short liq = price * (1 + 1/lev - mm)
    const shortLiq = price * (1 + 1 / lev - mm)

    levels.push({
      price: longLiq,
      leverage: lev,
      side: 'long',
      estimatedSize: weight * 0.5,
    })
    levels.push({
      price: shortLiq,
      leverage: lev,
      side: 'short',
      estimatedSize: weight * 0.5,
    })
  }

  return levels.sort((a, b) => a.price - b.price)
}

function buildHeatmapBins(
  price: number,
  levels: LiquidationLevel[],
  binCount = 40,
): HeatmapBin[] {
  if (levels.length === 0 || price <= 0) return []

  // Range: ±15% from current price
  const lo = price * 0.85
  const hi = price * 1.15
  const step = (hi - lo) / binCount

  const bins: HeatmapBin[] = Array.from({ length: binCount }, (_, i) => ({
    priceLevel: lo + step * (i + 0.5),
    density: 0,
    longLiquidations: 0,
    shortLiquidations: 0,
    symbol: '',
  }))

  for (const lv of levels) {
    if (lv.price < lo || lv.price > hi) continue
    const idx = Math.min(binCount - 1, Math.floor((lv.price - lo) / step))
    const bin = bins[idx]
    if (lv.side === 'long') {
      bin.longLiquidations += lv.estimatedSize
    } else {
      bin.shortLiquidations += lv.estimatedSize
    }
  }

  // Normalise density
  let maxDensity = 0
  for (const bin of bins) {
    const d = bin.longLiquidations + bin.shortLiquidations
    if (d > maxDensity) maxDensity = d
  }
  if (maxDensity > 0) {
    for (const bin of bins) {
      bin.density = (bin.longLiquidations + bin.shortLiquidations) / maxDensity
    }
  }

  return bins
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol') ?? 'BTC'

  try {
    const [markets, fundingRates, leaderboard] = await Promise.all([
      getHyperliquidMarkets(),
      getHyperliquidFundingRates(),
      getHyperliquidLeaderboard(),
    ])

    // Build per-market liquidation data
    const marketLiqs: MarketLiq[] = markets
      .filter(m => m.price > 0)
      .map(m => {
        const levels = computeLiquidationLevels(
          m.price,
          m.openInterest,
          m.maxLeverage,
          m.symbol,
        )
        const heatmapBins = buildHeatmapBins(m.price, levels)
        return {
          symbol: m.symbol,
          price: m.price,
          markPrice: m.markPrice,
          openInterest: m.openInterest,
          fundingRate: m.fundingRate,
          maxLeverage: m.maxLeverage,
          priceChange24h: m.priceChange24h,
          liquidationLevels: levels,
          heatmapBins,
        }
      })

    // Find the spotlight market
    const spotlight = marketLiqs.find(m => m.symbol === symbol)
      || marketLiqs.find(m => m.symbol === 'BTC')
      || marketLiqs[0]
      || null

    // Aggregate all bins for the global heatmap (normalised to spotlight's price range)
    const aggregatedBins = spotlight?.heatmapBins ?? []

    // Top 10 by estimated OI size
    const topPositions = marketLiqs
      .sort((a, b) => b.openInterest - a.openInterest)
      .slice(0, 10)
      .map(m => ({
        symbol: m.symbol,
        price: m.price,
        openInterest: m.openInterest,
        fundingRate: m.fundingRate,
        maxLeverage: m.maxLeverage,
      }))

    // Funding rates for the strip
    const fundingStrip = fundingRates
      .filter(f => f.rate !== 0)
      .sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate))
      .slice(0, 20)

    return NextResponse.json({
      data: {
        spotlight: spotlight ? {
          symbol: spotlight.symbol,
          price: spotlight.price,
          markPrice: spotlight.markPrice,
          openInterest: spotlight.openInterest,
          fundingRate: spotlight.fundingRate,
          maxLeverage: spotlight.maxLeverage,
        } : null,
        heatmap: aggregatedBins,
        fundingStrip,
        topPositions,
        leaderboard: leaderboard.slice(0, 10),
      },
      meta: {
        symbol,
        marketCount: markets.length,
        timestamp: Date.now(),
      },
      error: null,
    }, {
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' },
    })
  } catch (err) {
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 502 },
    )
  }
}
