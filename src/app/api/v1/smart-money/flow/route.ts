// ─────────────────────────────────────────────────────────────
// GET /api/v1/smart-money/flow — Smart Money Flow Board
// Returns net buy/sell by entity category from entity label DB
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getEntitySeeds } from '@/lib/modules/ai-signals/entity-labels-seed'

interface CategoryFlow {
  category: string
  label: string
  entityCount: number
  chains: string[]
  icon: string
}

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  cex:      { label: 'Centralized Exchanges', icon: '🏦' },
  vc:       { label: 'VC Funds & Trading', icon: '💼' },
  whale:    { label: 'Known Whales', icon: '🐋' },
  defi:     { label: 'DeFi Protocols', icon: '🔗' },
  protocol: { label: 'Token Contracts', icon: '📄' },
  dao:      { label: 'DAOs & Governance', icon: '🏛️' },
}

export async function GET() {
  try {
    const allSeeds = await getEntitySeeds()
    const categories = new Map<string, { count: number; chains: Set<string> }>()

    for (const entity of allSeeds) {
      const existing = categories.get(entity.category) ?? { count: 0, chains: new Set() }
      existing.count++
      existing.chains.add(entity.chain)
      categories.set(entity.category, existing)
    }

    const flows: CategoryFlow[] = Array.from(categories.entries())
      .map(([cat, data]) => ({
        category: cat,
        label: CATEGORY_META[cat]?.label ?? cat,
        icon: CATEGORY_META[cat]?.icon ?? '📊',
        entityCount: data.count,
        chains: Array.from(data.chains),
      }))
      .sort((a, b) => b.entityCount - a.entityCount)

    return NextResponse.json({
      flows,
      totalEntities: allSeeds.length,
      chains: [...new Set(allSeeds.map(e => e.chain))],
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  } catch (err) {
    console.error('[smart-money/flow] Error:', err)
    return NextResponse.json(
      { error: (err as Error).message, flows: [] },
      { status: 502 },
    )
  }
}
