// ─────────────────────────────────────────────────────────────
// GET /api/v1/cycle-indicators — On-Chain Cycle Indicators
// MVRV Z-Score, NUPL, SSR, Stablecoin Dominance
// Data source: CoinGecko (free, no API key)
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'
import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'current'

  try {
    switch (action) {
      case 'current': {
        const { data, fromCache } = await getCached('cycle-indicators:current', 300_000, async () => {
          const registry = registerAllModules()
          const result = await registry.fetchOne('cycle-indicators', { action: 'current' })
          return result.data
        })

        // Persist to DB (fire-and-forget)
        const indicatorData = data as Record<string, unknown>
        const indicators = indicatorData?.indicators as Record<string, { value: number; zone: string }> | undefined
        if (indicators) {
          const now = new Date()
          const snapshots = Object.entries(indicators).map(([key, ind]) => ({
            indicator: key,
            value: ind.value,
            zone: ind.zone,
            timestamp: now,
          }))
          prisma.cycleIndicatorSnapshot.createMany({ data: snapshots }).catch(() => {})
        }

        const resp = NextResponse.json({ data, error: null }, {
          headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
        })
        resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
        return resp
      }

      case 'history': {
        const indicator = searchParams.get('indicator') ?? 'mvrv'
        const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500)

        const { data, fromCache } = await getCached(`cycle-indicators:history:${indicator}:${limit}`, 60_000, async () => {
          const rows = await prisma.cycleIndicatorSnapshot.findMany({
            where: { indicator },
            orderBy: { timestamp: 'desc' },
            take: limit,
          })
          return rows.reverse() // chronological order
        })

        const resp = NextResponse.json({ data, error: null }, {
          headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
        })
        resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
        return resp
      }

      default:
        return NextResponse.json(
          { data: null, error: `Unknown action: ${action}` },
          { status: 400 },
        )
    }
  } catch (err) {
    console.error('[cycle-indicators] Error:', err)
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 502 },
    )
  }
}
