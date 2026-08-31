// ─────────────────────────────────────────────────────────────
// GET /api/v1/yields — Top DeFi yields from DeFiLlama
// Free, no API key needed. 15,975+ pools.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'

interface YieldPool {
  pool: string
  project: string
  symbol: string
  chain: string
  tvlUsd: number
  apy: number
  apyBase: number
  apyReward: number | null
  stablecoin: boolean
  ilRisk: string
  exposure: string
  predictions: {
    predictedClass: string
    predictedProbability: number
    binnedConfidence: number
  }
  mu: number
  sigma: number
  count: number
}

async function fetchYields() {
  const res = await fetch('https://yields.llama.fi/pools', {
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`)

  const data = (await res.json()) as { data: YieldPool[] }

  // Filter and sort: non-stablecoin, TVL > $1M, APY > 1%
  const filtered = data.data
    .filter(p => p.tvlUsd > 1_000_000 && p.apy > 1 && !p.stablecoin && p.apy < 1000)
    .sort((a, b) => b.apy - a.apy)
    .slice(0, 50)
    .map(p => ({
      pool: p.pool,
      project: p.project,
      symbol: p.symbol,
      chain: p.chain,
      tvlUsd: p.tvlUsd,
      apy: p.apy,
      apyBase: p.apyBase,
      apyReward: p.apyReward ?? 0,
      stablecoin: p.stablecoin,
      ilRisk: p.ilRisk,
      exposure: p.exposure,
      prediction: p.predictions?.predictedClass ?? 'unknown',
      confidence: p.predictions?.binnedConfidence ?? 0,
    }))

  // Also get top stablecoin yields
  const stableYields = data.data
    .filter(p => p.tvlUsd > 10_000_000 && p.apy > 0.5 && p.stablecoin)
    .sort((a, b) => b.apy - a.apy)
    .slice(0, 20)
    .map(p => ({
      pool: p.pool,
      project: p.project,
      symbol: p.symbol,
      chain: p.chain,
      tvlUsd: p.tvlUsd,
      apy: p.apy,
      apyBase: p.apyBase,
      apyReward: p.apyReward ?? 0,
      stablecoin: p.stablecoin,
      ilRisk: p.ilRisk,
      exposure: p.exposure,
      prediction: p.predictions?.predictedClass ?? 'unknown',
      confidence: p.predictions?.binnedConfidence ?? 0,
    }))

  return { topYields: filtered, stableYields, totalCount: data.data.length }
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('yields', 300_000, fetchYields) // 5min cache
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Yields error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch yields' }, { status: 502 })
  }
}