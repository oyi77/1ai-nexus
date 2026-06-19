// ─────────────────────────────────────────────────────────────
// GET /api/v1/signals — Cross-source correlated signals
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getRecentSignals, detectSignals } from '@/lib/modules/derived/signal-engine'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  const registry = registerAllModules()

  // Gather context for signal detection
  const [fgRes, priceRes] = await Promise.allSettled([
    registry.fetchOne<Array<{ value: number; classification: string }>>('fear-greed', { limit: '1' }),
    registry.fetchOne('coingecko', { action: 'global' }),
  ])

  const fearGreed = fgRes.status === 'fulfilled' ? fgRes.value.data?.[0] : undefined
  const globalData = priceRes.status === 'fulfilled' ? (priceRes.value.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined : undefined
  const btcDominance = globalData?.market_cap_percentage ? (globalData.market_cap_percentage as Record<string, number>).btc : undefined

  // Run signal detection
  const newSignals = detectSignals({
    fearGreed: fearGreed?.value,
    fearGreedClassification: fearGreed?.classification,
    btcDominance,
  })

  const recent = getRecentSignals(30)

  return NextResponse.json({
    signals: recent,
    newSignals: newSignals.length,
    count: recent.length,
  })
}
