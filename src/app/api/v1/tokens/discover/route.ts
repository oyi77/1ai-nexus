// ─────────────────────────────────────────────────────────────
// GET /api/v1/tokens/discover — Token Discovery Engine
// Combines GeckoTerminal + DexScreener + Smart Money scoring
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

interface DiscoveredToken {
  name: string
  symbol: string
  address: string
  network: string
  priceUsd: number
  volume24h: number
  liquidity: number
  change24h: number
  age: string
  rugScore: number        // 0-100 (0 = safe, 100 = rug)
  smartMoneyPct: number   // % of buys from labeled wallets
  badges: string[]
}

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const sort = searchParams.get('sort') ?? 'trending'
  const limit = Math.min(50, Math.max(10, Number(searchParams.get('limit') ?? 30)))

  try {
    // Fetch trending pools from GeckoTerminal
    const action = sort === 'new' ? 'new' : 'trending'
    const gtResult = await registry.fetchOne<Array<Record<string, unknown>>>(
      'geckoterminal',
      { action, limit }
    )

    const tokens: DiscoveredToken[] = (gtResult.data ?? []).map(pool => {
      const attrs = (pool.attributes ?? {}) as Record<string, unknown>
      const network = (pool.relationships as Record<string, Record<string, Record<string, string>>>)?.network?.data?.id ?? 'unknown'
      const vol24h = Number((attrs.volume_usd as Record<string, string>)?.h24 ?? 0)
      const liq = Number(attrs.reserve_in_usd ?? 0)
      const change = Number((attrs.price_change_percentage as Record<string, string>)?.h24 ?? 0)
      const price = Number(attrs.base_token_price_usd ?? 0)
      const name = String(attrs.name ?? 'Unknown')
      const address = String(attrs.address ?? '')
      const symbol = name.split(' / ')[0] ?? '?'
      const createdAt = String(attrs.pool_created_at ?? '')

      // Rug risk scoring
      const rugScore = computeRugScore({
        liquidity: liq,
        volume24h: vol24h,
        change24h: change,
        age: createdAt,
        transactions: attrs.transactions as Record<string, Record<string, number>> | undefined,
      })

      // Badges
      const badges: string[] = []
      if (rugScore >= 70) badges.push('⚠️ HIGH RISK')
      else if (rugScore >= 40) badges.push('⚡ MEDIUM RISK')
      if (vol24h > 1_000_000) badges.push('🔥 HOT')
      if (liq > 100_000) badges.push('💧 DEEP LIQ')
      if (createdAt && isNewerThan(createdAt, 3600)) badges.push('🆕 <1H OLD')

      return {
        name,
        symbol,
        address,
        network,
        priceUsd: price,
        volume24h: vol24h,
        liquidity: liq,
        change24h: change,
        age: createdAt ? formatAge(createdAt) : '—',
        rugScore,
        smartMoneyPct: 0, // Will be populated when entity DB is expanded
        badges,
      }
    })

    // Sort
    if (sort === 'volume') tokens.sort((a, b) => b.volume24h - a.volume24h)
    else if (sort === 'new') tokens.sort((a, b) => a.age.localeCompare(b.age))
    else if (sort === 'liquidity') tokens.sort((a, b) => b.liquidity - a.liquidity)
    else tokens.sort((a, b) => b.volume24h - a.volume24h) // trending = volume

    return NextResponse.json({ tokens, count: tokens.length }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    })
  } catch (err) {
    console.error('[tokens/discover] Error:', err)
    return NextResponse.json({ tokens: [], count: 0 })
  }
}

function computeRugScore(params: {
  liquidity: number
  volume24h: number
  change24h: number
  age: string
  transactions?: Record<string, Record<string, number>>
}): number {
  let score = 0

  // Low liquidity = high risk
  if (params.liquidity < 1000) score += 40
  else if (params.liquidity < 10_000) score += 25
  else if (params.liquidity < 50_000) score += 10

  // Extreme price change = suspicious
  if (Math.abs(params.change24h) > 500) score += 20
  else if (Math.abs(params.change24h) > 100) score += 10

  // Very new token = higher risk
  if (params.age && isNewerThan(params.age, 3600)) score += 15  // < 1 hour
  else if (params.age && isNewerThan(params.age, 86400)) score += 5  // < 1 day

  // Low buy/sell ratio imbalance
  if (params.transactions) {
    const buys = params.transactions.h24?.buys ?? 0
    const sells = params.transactions.h24?.sells ?? 0
    if (buys > 0 && sells > 0) {
      const ratio = Math.max(buys, sells) / Math.min(buys, sells)
      if (ratio > 5) score += 15 // Heavily imbalanced
      else if (ratio > 3) score += 5
    }
  }

  return Math.min(100, score)
}

function isNewerThan(isoDate: string, seconds: number): boolean {
  try {
    const created = new Date(isoDate).getTime()
    return Date.now() - created < seconds * 1000
  } catch {
    return false
  }
}

function formatAge(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime()
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
    return `${Math.floor(diff / 86_400_000)}d`
  } catch {
    return '—'
  }
}
