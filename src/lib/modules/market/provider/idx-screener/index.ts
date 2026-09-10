// ─────────────────────────────────────────────────────────────
// IDX Screener provider — reads IdxScreenerSnapshot via Prisma.
// Zero runtime upstream.
//
// Units contract:
//   per/pbv multiples · der ratio · roa/roe/npm % · eps IDR ·
//   revenue IDR · marketCap IDR · price IDR · change1d % ·
//   hi52w/lo52w IDR · volume shares · change4w/13w/26w/52w % · ytd %
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'

export interface ScreenerRow {
  symbol: string
  name: string
  sector: string
  subsector: string
  industry: string
  subindustry: string
  per: number | null
  pbv: number | null
  der: number | null
  roa: number | null
  roe: number | null
  npm: number | null
  eps: number | null
  revenue: number | null
  marketCap: number | null
  price: number | null
  change1d: number | null
  high52w: number | null
  low52w: number | null
  volume: number | null
  change4w: number | null
  change13w: number | null
  change26w: number | null
  change52w: number | null
  ytd: number | null
}

const CACHE_TTL = 10 * 60_000

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\.JK$/, '')
}

interface SnapshotData {
  snapshotDate: string
  data: Record<string, ScreenerRow>
}

async function loadSnapshot(): Promise<SnapshotData> {
  const { data } = await getCached('idx-screener:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxScreenerSnapshot.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (!latest) return { snapshotDate: '', data: {} }

    const rows = await prisma.idxScreenerSnapshot.findMany({
      where: { snapshotDate: latest.snapshotDate },
    })
    const map: Record<string, ScreenerRow> = {}
    for (const r of rows) {
      map[r.code] = {
        symbol: r.code,
        name: r.name,
        sector: r.sector,
        subsector: r.subsector,
        industry: r.industry,
        subindustry: r.subindustry,
        per: r.per,
        pbv: r.pbv,
        der: r.der,
        roa: r.roa,
        roe: r.roe,
        npm: r.npm,
        eps: r.eps,
        revenue: r.revenue,
        marketCap: r.marketCap,
        price: r.price,
        change1d: r.change1d,
        high52w: r.high52w,
        low52w: r.low52w,
        volume: r.volume,
        change4w: r.change4w,
        change13w: r.change13w,
        change26w: r.change26w,
        change52w: r.change52w,
        ytd: r.ytd,
      }
    }
    return { snapshotDate: latest.snapshotDate, data: map }
  })
  return data
}

export async function getScreenerSnapshot(): Promise<{
  capturedAt: string
  source: string
  total: number
  count: number
  data: Record<string, ScreenerRow>
}> {
  const snap = await loadSnapshot()
  return {
    capturedAt: snap.snapshotDate,
    source: 'prisma:IdxScreenerSnapshot',
    total: Object.keys(snap.data).length,
    count: Object.keys(snap.data).length,
    data: snap.data,
  }
}

export async function getScreenerStock(code: string): Promise<ScreenerRow | null> {
  const snap = await loadSnapshot()
  return snap.data[normalizeCode(code)] ?? null
}

export async function getScreenerBySector(sector: string): Promise<ScreenerRow[]> {
  const snap = await loadSnapshot()
  return Object.values(snap.data).filter(
    (r) => r.sector.toLowerCase() === sector.toLowerCase()
  )
}

export async function getTopMovers(
  n = 20,
  direction: 'gainers' | 'losers' = 'gainers'
): Promise<ScreenerRow[]> {
  const snap = await loadSnapshot()
  const items = Object.values(snap.data).filter((r) => r.change1d != null)
  items.sort((a, b) =>
    direction === 'gainers'
      ? (b.change1d ?? 0) - (a.change1d ?? 0)
      : (a.change1d ?? 0) - (b.change1d ?? 0)
  )
  return items.slice(0, n)
}
