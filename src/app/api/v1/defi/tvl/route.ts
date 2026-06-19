// ─────────────────────────────────────────────────────────────
// GET /api/v1/defi/tvl — DeFi TVL Dashboard
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const chain = searchParams.get('chain') ?? undefined
  const limit = Math.min(100, Math.max(10, Number(searchParams.get('limit') ?? 50)))

  try {
    const result = await registry.fetchOne<Array<Record<string, unknown>>>('defillama', { action: 'protocols' })
    let protocols = (result.data ?? [])
      .filter((p: Record<string, unknown>) => typeof p.tvl === 'number' && p.tvl > 0)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.tvl as number) - (a.tvl as number))

    if (chain) {
      protocols = protocols.filter((p: Record<string, unknown>) => (p.chain as string)?.toLowerCase() === chain.toLowerCase())
    }

    const sliced = protocols.slice(0, limit).map((p: Record<string, unknown>) => ({
      name: p.name,
      chain: p.chain,
      tvl: p.tvl,
      change_1d: p.change_1d,
      change_7d: p.change_7d,
      category: p.category,
    }))

    const totalTvl = sliced.reduce((sum, p) => sum + (Number(p.tvl) || 0), 0)

    return NextResponse.json({ protocols: sliced, totalTvl, count: sliced.length })
  } catch (err) {
    console.error('[defi/tvl] Error:', err)
    return NextResponse.json({ protocols: [], totalTvl: 0, count: 0 })
  }
}
