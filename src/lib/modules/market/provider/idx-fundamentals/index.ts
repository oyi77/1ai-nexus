// ─────────────────────────────────────────────────────────────
// IDX Fundamentals provider — reads IdxFundamentals via Prisma.
// Zero runtime upstream calls.
//
// Units contract (set by the harvester):
//   per/pbv multiples · roe % · der ratio · eps IDR ·
//   marketCap IDR · dividendYield %
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'

export interface FundRow {
  per?: number | null
  pbv?: number | null
  roe?: number | null
  der?: number | null
  eps?: number | null
  marketCap?: number | null
  dividendYield?: number | null
}

const CACHE_TTL = 10 * 60_000

interface SnapshotData {
  snapshotDate: string
  data: Record<string, FundRow>
}

async function loadSnapshot(): Promise<SnapshotData> {
  const { data } = await getCached('idx-fundamentals:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxFundamentals.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (!latest) return { snapshotDate: '', data: {} }

    const rows = await prisma.idxFundamentals.findMany({
      where: { snapshotDate: latest.snapshotDate },
    })
    const map: Record<string, FundRow> = {}
    for (const r of rows) {
      map[r.code] = {
        per: r.per,
        pbv: r.pbv,
        roe: r.roe,
        der: r.der,
        eps: r.eps,
        marketCap: r.marketCap,
        dividendYield: r.dividendYield,
      }
    }
    return { snapshotDate: latest.snapshotDate, data: map }
  })
  return data
}

/** Normalize user input: 'BBCA.JK'/'bbca' → 'BBCA'. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\.JK$/, '')
}

export async function getFundamentalsSnapshot(): Promise<{
  capturedAt: string
  count: number
  data: Record<string, FundRow>
}> {
  const snap = await loadSnapshot()
  return { capturedAt: snap.snapshotDate, count: Object.keys(snap.data).length, data: snap.data }
}

export async function getFundamentals(code: string): Promise<FundRow | null> {
  const snap = await loadSnapshot()
  return snap.data[normalizeCode(code)] ?? null
}
