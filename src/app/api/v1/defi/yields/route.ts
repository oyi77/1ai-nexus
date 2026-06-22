// ─────────────────────────────────────────────────────────────
// GET /api/v1/defi/yields — DeFi Yield Finder
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { registerAllModules } from '@/lib/modules'
export async function GET(request: Request) {
  const registry = registerAllModules()
  const { searchParams } = new URL(request.url)
  const chain = searchParams.get('chain') ?? undefined
  const stablecoinOnly = searchParams.get('stablecoin') === 'true'
  const limit = Math.min(50, Math.max(10, Number(searchParams.get('limit') ?? 30)))

  try {
    const result = await registry.fetchOne('defillama', { action: 'yields' })
    const raw = result.data as Record<string, unknown> | unknown[] | null

    // Handle various response formats from DeFiLlama
    let pools: Record<string, unknown>[] = []
    if (Array.isArray(raw)) {
      pools = raw.map(v => v as Record<string, unknown>)
    } else if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray(raw.data)) {
      pools = (raw.data as unknown[]).map(v => v as Record<string, unknown>)
    } else if (raw && typeof raw === 'object' && 'pools' in raw && Array.isArray(raw.pools)) {
      pools = (raw.pools as unknown[]).map(v => v as Record<string, unknown>)
    } else if (raw && typeof raw === 'object') {
      // Try to extract any array from the response
      const values = Object.values(raw)
      const arrayValue = values.find(v => Array.isArray(v))
      if (arrayValue) {
        pools = (arrayValue as unknown[]).map(v => v as Record<string, unknown>)
      }
    }

    // Log if no pools found for debugging
    if (pools.length === 0) {
      console.warn('[defi/yields] No pools found in response:', {
        type: typeof raw,
        isArray: Array.isArray(raw),
        keys: raw ? Object.keys(raw).slice(0, 10) : [],
        sample: JSON.stringify(raw).slice(0, 200),
      })
    }

    if (chain) {
      pools = pools.filter((p: Record<string, unknown>) => 
        (p.chain as string)?.toLowerCase() === chain.toLowerCase()
      )
    }
    if (stablecoinOnly) {
      pools = pools.filter((p: Record<string, unknown>) => p.stablecoin === true)
    }

    const sorted = pools
      .filter((p: Record<string, unknown>) => typeof p.apy === 'number' && p.apy > 0)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => 
        (b.apy as number) - (a.apy as number)
      )
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

    return NextResponse.json({ data: { pools: sorted, count: sorted.length, totalAvailable: pools.length, source: 'defillama', timestamp: new Date().toISOString() }, meta: undefined, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
    })
  } catch (err) {
    console.error('[defi/yields] Error:', err)
    return apiError('[defi/yields] Failed to fetch yield data', 502)
  }
}
