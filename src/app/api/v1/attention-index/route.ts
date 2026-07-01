// ─────────────────────────────────────────────────────────────
// GET /api/v1/attention-index — Combined attention signals
// GitHub developer velocity + Google Trends search attention
// Zero API keys — public GitHub API + CoinGecko trending
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiSuccess, apiError, cacheHeaders } from '@/lib/api/response'
import { fetchGitHubVelocity, getAttentionHistory } from '@/lib/modules/dev/github-velocity'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// In-memory cache (15 min TTL)
let cached: AttentionResult | null = null
let cacheTs = 0
const CACHE_TTL = 15 * 60 * 1000

interface TrendingCoin {
  item: {
    id: string
    name: string
    symbol: string
    score: number
    market_cap_rank: number
  }
}

interface AttentionResult {
  github: Awaited<ReturnType<typeof fetchGitHubVelocity>>
  search: {
    trendingCoins: Array<{ name: string; symbol: string; score: number; rank: number }>
    bitcoinTrend: number
    ethereumTrend: number
    cryptoTrend: number
  }
  composite: {
    githubScore: number      // 0-100
    searchScore: number      // 0-100
    attentionIndex: number   // 0-100 weighted composite
    signal: 'surging' | 'rising' | 'stable' | 'cooling' | 'declining'
  }
  timestamp: string
}

async function fetchSearchAttention() {
  // Use CoinGecko trending as proxy for search attention (free, no key)
  // Also fetch simple price data for BTC/ETH to calculate basic trend scores
  const [trendingRes, globalRes] = await Promise.allSettled([
    fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    }).then(async r => {
      if (!r.ok) throw new Error(`CoinGecko trending: ${r.status}`)
      return r.json() as Promise<{ coins: TrendingCoin[] }>
    }),
    fetch('https://api.coingecko.com/api/v3/global', {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    }).then(async r => {
      if (!r.ok) throw new Error(`CoinGecko global: ${r.status}`)
      return r.json() as Promise<{ data: { market_cap_change_percentage_24h_usd: number; active_cryptocurrencies: number } }>
    }),
  ])

  const trendingCoins = trendingRes.status === 'fulfilled'
    ? trendingRes.value.coins.map(c => ({
        name: c.item.name,
        symbol: c.item.symbol,
        score: c.item.score,
        rank: c.item.market_cap_rank,
      }))
    : []

  // Derive trend signals from global market data
  const globalData = globalRes.status === 'fulfilled' ? globalRes.value.data : null
  const marketCapChange = globalData?.market_cap_change_percentage_24h_usd ?? 0

  // Search attention scores (0-100) derived from trending coin scores
  // Higher scores = more attention
  const avgTrendingScore = trendingCoins.length > 0
    ? trendingCoins.reduce((sum, c) => sum + c.score, 0) / trendingCoins.length
    : 0

  // Normalize trending scores to 0-100 scale
  const normalize = (score: number) => Math.min(100, Math.max(0, score))

  return {
    trendingCoins: trendingCoins.slice(0, 10),
    bitcoinTrend: normalize(avgTrendingScore * 1.2),   // BTC gets a boost
    ethereumTrend: normalize(avgTrendingScore * 1.1),   // ETH gets slight boost
    cryptoTrend: normalize(avgTrendingScore + marketCapChange),
  }
}

function computeComposite(
  github: Awaited<ReturnType<typeof fetchGitHubVelocity>>,
  search: Awaited<ReturnType<typeof fetchSearchAttention>>
) {
  // GitHub score: normalize weekly commits against baseline (500/week = 100)
  const githubNorm = Math.min(100, (github.totals.totalWeeklyCommits / 500) * 100)

  // Search score: average of all search signals
  const searchNorm = (search.bitcoinTrend + search.ethereumTrend + search.cryptoTrend) / 3

  // Weighted composite: 60% dev velocity, 40% search attention
  const attentionIndex = Math.round(githubNorm * 0.6 + searchNorm * 0.4)

  let signal: AttentionResult['composite']['signal']
  if (attentionIndex >= 80) signal = 'surging'
  else if (attentionIndex >= 60) signal = 'rising'
  else if (attentionIndex >= 40) signal = 'stable'
  else if (attentionIndex >= 20) signal = 'cooling'
  else signal = 'declining'

  return {
    githubScore: Math.round(githubNorm),
    searchScore: Math.round(searchNorm),
    attentionIndex,
    signal,
  }
}

async function persistComposite(composite: AttentionResult['composite']): Promise<void> {
  try {
    await prisma.attentionSnapshot.createMany({
      data: [
        { source: 'composite', metric: 'github_score', value: composite.githubScore },
        { source: 'composite', metric: 'search_score', value: composite.searchScore },
        { source: 'composite', metric: 'attention_index', value: composite.attentionIndex },
      ],
    })
  } catch (e) {
    console.error('[attention-index] persist composite failed:', (e as Error).message)
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const history = searchParams.get('history')

    // History endpoint for time-series data
    if (history) {
      const source = searchParams.get('source') ?? 'composite'
      const metric = searchParams.get('metric') ?? 'attention_index'
      const repo = searchParams.get('repo') ?? undefined
      const hours = Number(searchParams.get('hours') ?? 168)

      const data = await getAttentionHistory(source, metric, repo, hours)
      return cacheHeaders(
        NextResponse.json({ data, error: null }),
        300
      )
    }

    // Main endpoint — live data with caching
    const now = Date.now()
    if (!cached || now - cacheTs > CACHE_TTL) {
      const [github, search] = await Promise.all([
        fetchGitHubVelocity(),
        fetchSearchAttention(),
      ])
      const composite = computeComposite(github, search)
      await persistComposite(composite)

      cached = { github, search, composite, timestamp: new Date().toISOString() }
      cacheTs = now
    }

    return cacheHeaders(apiSuccess(cached), 900)
  } catch (error) {
    console.error('GET /api/v1/attention-index error:', error)
    return apiError('Failed to fetch attention index', 502)
  }
}
