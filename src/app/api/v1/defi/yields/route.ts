// ─────────────────────────────────────────────────────────────
// GET /api/v1/defi/yields — DeFi Yield Finder
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const chain = searchParams.get('chain') ?? undefined
  const stablecoinOnly = searchParams.get('stablecoin') === 'true'
  const limit = Math.min(50, Math.max(10, Number(searchParams.get('limit') ?? 30)))

  try {
    const result = await registry.fetchOne('defillama', { action: 'yields' })
    const raw = result.data as any; let pools: any[] = Array.isArray(raw) ? raw : (raw?.data ?? raw ?? [])

    if (chain) {
      pools = pools.filter((p: Record<string, unknown>) => (p.chain as string)?.toLowerCase() === chain.toLowerCase())
    }
    if (stablecoinOnly) {
      pools = pools.filter((p: Record<string, unknown>) => p.stablecoin === true)
    }

    const sorted = pools
      .filter((p: Record<string, unknown>) => typeof p.apy === 'number' && p.apy > 0)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.apy as number) - (a.apy as number))
      .slice(0, limit)
      .map((p: Record<string, unknown>) => ({
        pool: p.pool,
        chain: p.chain,
        project: p.project,
        symbol: p.symbol,
        tvlUsd: p.tvlUsd,
        apy: p.apy,
        apyBase: p.apyBase,
        apyReward: p.apyReward,
        stablecoin: p.stablecoin,
      }))

    return NextResponse.json({ pools: sorted, count: sorted.length })
  } catch (err) {
    console.error('[defi/yields] Error:', err)
    return NextResponse.json({ pools: [], count: 0 })
  }
}
