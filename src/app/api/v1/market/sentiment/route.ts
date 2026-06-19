// ─────────────────────────────────────────────────────────────
// GET /api/v1/market/sentiment — Fear & Greed + other sentiment
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  const registry = registerAllModules()

  try {
    const result = await registry.fetchOne<Array<{ value: number; classification: string }>>('fear-greed', { limit: 1 })
    const data = result.data
    const latest = data?.[0]

    return NextResponse.json({
      fearGreed: latest?.value ?? null,
      classification: latest?.classification ?? 'Unknown',
      cached: result.cached,
    })
  } catch {
    return NextResponse.json({ fearGreed: null, classification: 'Unknown' })
  }
}
