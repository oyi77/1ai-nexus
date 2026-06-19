// ─────────────────────────────────────────────────────────────
// GET /api/v1/smart-money/flow — Smart Money Flow Board
// Returns net buy/sell by entity category from entity label DB
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { ENTITY_SEEDS } from '@/lib/modules/ai-signals/entity-labels-seed'

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
  const categories = new Map<string, { count: number; chains: Set<string> }>()

  for (const entity of ENTITY_SEEDS) {
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
    totalEntities: ENTITY_SEEDS.length,
    chains: [...new Set(ENTITY_SEEDS.map(e => e.chain))],
  })
}
