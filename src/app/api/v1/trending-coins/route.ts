// ─────────────────────────────────────────────────────────────
// GET /api/v1/trending — Trending tokens from CoinGecko
// Free, no API key needed
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface TrendingToken {
  id: string
  name: string
  symbol: string
  marketCapRank: number
  priceUsd: number
  priceChange24h: number
  score: number
  thumb: string
}

async function fetchTrending() {
  const [trendingRes, globalRes] = await Promise.all([
    fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(15_000),
    }),
    fetch('https://api.coingecko.com/api/v3/global', {
      signal: AbortSignal.timeout(10_000),
    }),
  ])

  if (!trendingRes.ok) throw new Error(`CoinGecko trending error: ${trendingRes.status}`)

  const trending = (await trendingRes.json()) as {
    coins: Array<{
      item: {
        id: string
        name: string
        symbol: string
        market_cap_rank: number
        price_btc: number
        score: number
        thumb: string
        data?: {
          price: number
          price_change_percentage_24h: { usd: number }
        }
      }
    }>
  }

  let globalData = null
  if (globalRes.ok) {
    const g = (await globalRes.json()) as {
      data: {
        total_market_cap: { usd: number }
        market_cap_change_percentage_24h_usd: number
        active_cryptocurrencies: number
        markets: number
      }
    }
    globalData = {
      totalMarketCap: g.data.total_market_cap.usd,
      marketCapChange24h: g.data.market_cap_change_percentage_24h_usd,
      activeCryptos: g.data.active_cryptocurrencies,
      markets: g.data.markets,
    }
  }

  const tokens: TrendingToken[] = trending.coins.map(c => ({
    id: c.item.id,
    name: c.item.name,
    symbol: c.item.symbol.toUpperCase(),
    marketCapRank: c.item.market_cap_rank,
    priceUsd: c.item.data?.price ?? c.item.price_btc,
    priceChange24h: c.item.data?.price_change_percentage_24h?.usd ?? 0,
    score: c.item.score,
    thumb: c.item.thumb,
  }))

  return { tokens, global: globalData }
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('trending', 120_000, fetchTrending) // 2min cache
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Trending error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch trending' }, { status: 502 })
  }
}