// ─────────────────────────────────────────────────────────────
// GET /api/v1/liquidations — Hyperliquid market and theoretical liquidation zones
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  getHyperliquidMarkets,
  getHyperliquidFundingRates,
  getHyperliquidLeaderboard,
} from '@/lib/modules/onchain/hyperliquid/dex'

interface LiquidationZone {
  priceLevel: number
  leverage: number
  side: 'long' | 'short'
  maintenanceMarginRate: number
  model: string
}

const LEVERAGE_TIERS = [2, 3, 5, 10, 20, 50, 75, 100]
const MAINTENANCE_MARGIN_RATE = 0.005

function computeLiquidationZones(price: number, maxLeverage: number): LiquidationZone[] {
  const tiers = LEVERAGE_TIERS.filter(t => t <= maxLeverage || maxLeverage === 0)
  return tiers.flatMap(leverage => [
    { priceLevel: price * (1 - 1 / leverage + MAINTENANCE_MARGIN_RATE), leverage, side: 'long' as const },
    { priceLevel: price * (1 + 1 / leverage - MAINTENANCE_MARGIN_RATE), leverage, side: 'short' as const },
  ]).map(level => ({
    ...level,
    maintenanceMarginRate: MAINTENANCE_MARGIN_RATE,
    model: 'Theoretical isolated-margin zone; no position size or liquidation density inferred',
  })).sort((a, b) => a.priceLevel - b.priceLevel)
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

    const marketLiqs = markets
      .filter(m => m.price > 0)
      .map(m => ({
        symbol: m.symbol,
        price: m.price,
        markPrice: m.markPrice,
        openInterest: m.openInterest,
        fundingRate: m.fundingRate,
        maxLeverage: m.maxLeverage,
        priceChange24h: m.priceChange24h,
        liquidationZones: computeLiquidationZones(m.price, m.maxLeverage),
      }))

    const spotlight = marketLiqs.find(m => m.symbol === symbol)
      || marketLiqs.find(m => m.symbol === 'BTC')
      || marketLiqs[0]
      || null

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
          priceChange24h: spotlight.priceChange24h,
          liquidationZones: spotlight.liquidationZones,
        } : null,
        liquidationZones: spotlight?.liquidationZones ?? [],
        heatmap: [],
        fundingStrip,
        topPositions,
        leaderboard: leaderboard.slice(0, 10),
      },
      meta: { symbol, marketCount: markets.length, timestamp: Date.now() },
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
