// ─────────────────────────────────────────────────────────────
// GET /api/v1/sector-flows — Sector money flow analysis
// DeFiLlama protocol data grouped by category
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface Protocol {
  name: string
  category: string
  tvl: number
  change_1d: number
  change_7d: number
  chains: string[]
}

interface CategoryData {
  name: string
  tvl: number
  tvlChange24h: number
  tvlChange7d: number
  dominance: number
  protocolCount: number
  topProtocols: Array<{ name: string; tvl: number }>
}

interface SectorFlows {
  categories: CategoryData[]
  totalTvl: number
  topGainers: Array<{ name: string; tvlChange7d: number }>
  topLosers: Array<{ name: string; tvlChange7d: number }>
  chainTvl: Array<{ chain: string; tvl: number }>
}

async function fetchSectorFlows(): Promise<SectorFlows> {
  const res = await fetch('https://api.llama.fi/protocols', {
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`)

  const protocols = (await res.json()) as Protocol[]

  // Group by category
  const categoryMap = new Map<string, {
    tvl: number
    change24h: number
    change7d: number
    count: number
    protocols: Array<{ name: string; tvl: number }>
  }>()

  let totalTvl = 0
  const chainTvlMap = new Map<string, number>()

  for (const p of protocols) {
    const cat = p.category || 'Unknown'
    const tvl = p.tvl || 0
    totalTvl += tvl

    // Chain TVL
    if (p.chains) {
      for (const chain of p.chains) {
        chainTvlMap.set(chain, (chainTvlMap.get(chain) || 0) + tvl / (p.chains?.length || 1))
      }
    }

    // Category aggregation
    const existing = categoryMap.get(cat)
    if (existing) {
      existing.tvl += tvl
      existing.change24h += (p.change_1d || 0) * tvl
      existing.change7d += (p.change_7d || 0) * tvl
      existing.count += 1
      existing.protocols.push({ name: p.name, tvl })
    } else {
      categoryMap.set(cat, {
        tvl,
        change24h: (p.change_1d || 0) * tvl,
        change7d: (p.change_7d || 0) * tvl,
        count: 1,
        protocols: [{ name: p.name, tvl }],
      })
    }
  }

  // Build categories
  const categories: CategoryData[] = [...categoryMap.entries()]
    .map(([name, data]) => ({
      name,
      tvl: data.tvl,
      tvlChange24h: data.tvl > 0 ? (data.change24h / data.tvl) : 0,
      tvlChange7d: data.tvl > 0 ? (data.change7d / data.tvl) : 0,
      dominance: totalTvl > 0 ? (data.tvl / totalTvl) * 100 : 0,
      protocolCount: data.count,
      topProtocols: data.protocols.sort((a, b) => b.tvl - a.tvl).slice(0, 3),
    }))
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 20)

  // Top gainers/losers by 7d change
  const withChange = categories.filter(c => c.tvl > 100_000_000) // >$100M TVL
  const topGainers = [...withChange].sort((a, b) => b.tvlChange7d - a.tvlChange7d).slice(0, 5).map(c => ({ name: c.name, tvlChange7d: c.tvlChange7d }))
  const topLosers = [...withChange].sort((a, b) => a.tvlChange7d - b.tvlChange7d).slice(0, 5).map(c => ({ name: c.name, tvlChange7d: c.tvlChange7d }))

  // Chain TVL
  const chainTvl = [...chainTvlMap.entries()]
    .map(([chain, tvl]) => ({ chain, tvl }))
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 15)

  return { categories, totalTvl, topGainers, topLosers, chainTvl }
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('sector-flows', 300_000, fetchSectorFlows)
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Sector flows error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch sector flows' }, { status: 502 })
  }
}