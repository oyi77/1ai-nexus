// ─────────────────────────────────────────────────────────────
// GET /api/v1/defi/overview — Comprehensive DeFi intelligence
// DEX volume, stablecoins, bridges, fees, yields in one call
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  const registry = registerAllModules()

  const [tvlRes, dexRes, stableRes, feeRes, yieldRes] = await Promise.allSettled([
    registry.fetchOne('defillama', { action: 'chains' }),
    registry.fetchOne('defillama', { action: 'dex-volumes' }),
    registry.fetchOne('defillama', { action: 'stablecoins' }),
    registry.fetchOne('defillama', { action: 'fees' }),
    registry.fetchOne('defillama', { action: 'yields' }),
  ])

  return NextResponse.json({
    chains: tvlRes.status === 'fulfilled' ? tvlRes.value.data : null,
    dexVolumes: dexRes.status === 'fulfilled' ? dexRes.value.data : null,
    stablecoins: stableRes.status === 'fulfilled' ? stableRes.value.data : null,
    fees: feeRes.status === 'fulfilled' ? feeRes.value.data : null,
    yields: yieldRes.status === 'fulfilled' ? yieldRes.value.data : null,
  })
}
