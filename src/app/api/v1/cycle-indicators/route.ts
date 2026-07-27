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
    if (action === 'current') {
      try {
        const fallbackData = await fetchLatestFromDb()
        return NextResponse.json({ data: fallbackData, error: null }, {
          headers: { 'Cache-Control': 'public, max-age=60' }
        })
      } catch (dbErr) {
        console.error('[cycle-indicators] DB Fallback failed:', dbErr)
      }
    }
    return NextResponse.json(
      { data: null, error: (err as Error).message },
      { status: 502 },
    )
  }
}

async function fetchLatestFromDb() {
  const indicators = ['mvrv', 'nupl', 'ssr', 'dominance']
  const results: Record<string, unknown> = {}
  let latestTimestamp = new Date().toISOString()

  for (const ind of indicators) {
    const row = await prisma.cycleIndicatorSnapshot.findFirst({
      where: { indicator: ind },
      orderBy: { timestamp: 'desc' }
    })
    if (row) {
      latestTimestamp = row.timestamp.toISOString()
      const descriptions: Record<string, string> = {
        mvrv: 'Market Value to Realized Value Z-Score. Measures deviation of market cap from realized cap. >7 = extreme overvaluation.',
        nupl: 'Net Unrealized Profit/Loss. Ratio of unrealized profit to market cap. >0.75 = euphoria zone.',
        ssr: 'Stablecoin Supply Ratio. BTC market cap / stablecoin market cap. Low SSR = high buying pressure ready.',
        dominance: 'Stablecoin market cap as % of total crypto market cap. Rising = risk-off sentiment.'
      }
      const names: Record<string, string> = {
        mvrv: 'MVRV Z-Score',
        nupl: 'NUPL',
        ssr: 'SSR',
        dominance: 'Stablecoin Dominance'
      }
      results[ind] = {
        name: names[ind],
        value: row.value,
        zone: row.zone,
        description: descriptions[ind] || '',
        raw: {}
      }
    }
  }

  if (Object.keys(results).length === 0) {
    throw new Error("No historical data available in database.")
  }

  return {
    indicators: results,
    timestamp: latestTimestamp,
    source: 'CoinGecko (historical cache)'
  }
}
