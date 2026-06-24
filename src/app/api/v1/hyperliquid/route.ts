import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getHyperliquidMarkets, getHyperliquidFundingRates, getHyperliquidOpenInterest, getHyperliquidLeaderboard } from '@/lib/modules/onchain/hyperliquid-dex'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'markets'
  const limit = Math.min(50, Math.max(5, Number(searchParams.get('limit') ?? 20)))

  try {
    if (action === 'funding') {
      const rates = await getHyperliquidFundingRates()
      return NextResponse.json({ data: rates.slice(0, limit), error: null }, {
        headers: { 'Cache-Control': 'public, max-age=30' },
      })
    }

    if (action === 'oi') {
      const oi = await getHyperliquidOpenInterest()
      return NextResponse.json({ data: oi.slice(0, limit), error: null }, {
        headers: { 'Cache-Control': 'public, max-age=30' },
      })
    }

    if (action === 'leaderboard') {
      const lb = await getHyperliquidLeaderboard()
      return NextResponse.json({ data: lb, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=60' },
      })
    }

    // Default: markets
    const markets = await getHyperliquidMarkets()
    return NextResponse.json({ data: markets.slice(0, limit), count: markets.length, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=15' },
    })
  } catch (err) {
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 502 })
  }
}
