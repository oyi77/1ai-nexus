// ─────────────────────────────────────────────────────────────
// GET /api/v1/revenue — Protocol revenue metrics (Token Terminal style)
// DeFiLlama fees/revenue API
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface ProtocolFee {
  name: string
  category: string
  total24h: number
  total7d: number
  total30d: number
  revenue24h: number
  revenue30d: number
  change_1d: number
  change_7d: number
  change_1m: number
  mcap?: number
}

interface RevenueData {
  protocols: Array<{
    name: string
    category: string
    fees24h: number
    fees7d: number
    fees30d: number
    revenue24h: number
    revenue30d: number
    peRatio: number | null
    feeMargin: number | null
    change1d: number
    change7d: number
  }>
  totals: {
    totalFees24h: number
    totalFees30d: number
    totalRevenue24h: number
    totalRevenue30d: number
  }
  categories: Array<{
    name: string
    fees24h: number
    count: number
  }>
}

async function fetchRevenue(): Promise<RevenueData> {
  const res = await fetch(
    'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
    { signal: AbortSignal.timeout(30_000) },
  )

  if (!res.ok) throw new Error(`DeFiLlama fees error: ${res.status}`)

  const data = (await res.json()) as {
    protocols: ProtocolFee[]
  }

  // Sort by fees 24h, take top 50
  const sorted = [...(data.protocols || [])]
    .filter(p => (p.total24h || 0) > 0)
    .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
    .slice(0, 50)

  let totalFees24h = 0
  let totalFees30d = 0
  let totalRevenue24h = 0
  let totalRevenue30d = 0
  const categoryMap = new Map<string, { fees24h: number; count: number }>()

  const protocols = sorted.map(p => {
    const fees24h = p.total24h || 0
    const fees7d = p.total7d || 0
    const fees30d = p.total30d || 0
    const revenue24h = p.revenue24h || 0
    const revenue30d = p.revenue30d || 0
    const mcap = p.mcap || 0

    totalFees24h += fees24h
    totalFees30d += fees30d
    totalRevenue24h += revenue24h
    totalRevenue30d += revenue30d

    // P/E ratio = market cap / annualized revenue
    const annualizedRevenue = revenue24h * 365
    const peRatio = mcap > 0 && annualizedRevenue > 0 ? mcap / annualizedRevenue : null

    // Fee margin = revenue / fees
    const feeMargin = fees24h > 0 ? revenue24h / fees24h : null

    // Category aggregation
    const cat = p.category || 'Other'
    const existing = categoryMap.get(cat)
    if (existing) {
      existing.fees24h += fees24h
      existing.count += 1
    } else {
      categoryMap.set(cat, { fees24h, count: 1 })
    }

    return {
      name: p.name,
      category: cat,
      fees24h,
      fees7d,
      fees30d,
      revenue24h,
      revenue30d,
      peRatio,
      feeMargin,
      change1d: p.change_1d || 0,
      change7d: p.change_7d || 0,
    }
  })

  const categories = [...categoryMap.entries()]
    .map(([name, data]) => ({ name, fees24h: data.fees24h, count: data.count }))
    .sort((a, b) => b.fees24h - a.fees24h)
    .slice(0, 15)

  return {
    protocols,
    totals: { totalFees24h, totalFees30d, totalRevenue24h, totalRevenue30d },
    categories,
  }
}

export async function GET() {
  try {
    const { data, fromCache } = await getCached('revenue', 300_000, fetchRevenue)
    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Revenue error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch revenue' }, { status: 502 })
  }
}