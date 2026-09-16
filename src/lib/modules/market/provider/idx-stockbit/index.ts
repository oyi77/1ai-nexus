// ─────────────────────────────────────────────────────────────
// Stockbit provider — DB-first reads over the nightly harvest
// snapshots (IdxBandarSnapshot, IdxStockbitGuru, IdxStockbitAnalyst).
// Zero upstream calls at runtime. SERVER-ONLY.
// Consume via /api/v1/saham/stockbit.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'

const CACHE_TTL = 10 * 60_000

/** Normalize user input: 'BBCA.JK'/'bbri' → 'BBRI'. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\.JK$/, '')
}

export interface BandarSnapshotData {
  code: string
  tradeDate: string
  accdist: string
  avgAmount: number | null
  avgPct: number | null
  top1Amount: number | null
  top3Amount: number | null
  top5Amount: number | null
  top10Amount: number | null
  buyCount: number
  sellCount: number
  brokers: unknown
  matrix: unknown
}

async function loadBandarLatest(): Promise<{ tradeDate: string; rows: BandarSnapshotData[] }> {
  const { data } = await getCached('stockbit-bandar:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxBandarSnapshot.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) return { tradeDate: '', rows: [] as BandarSnapshotData[] }
    const dbRows = await prisma.idxBandarSnapshot.findMany({
      where: { tradeDate: latest.tradeDate },
    })
    return {
      tradeDate: latest.tradeDate,
      rows: dbRows.map(r => ({
        code: r.code,
        tradeDate: r.tradeDate,
        accdist: r.accdist,
        avgAmount: r.avgAmount,
        avgPct: r.avgPct,
        top1Amount: r.top1Amount,
        top3Amount: r.top3Amount,
        top5Amount: r.top5Amount,
        top10Amount: r.top10Amount,
        buyCount: r.buyCount,
        sellCount: r.sellCount,
        brokers: r.brokers,
        matrix: r.matrix,
      })),
    }
  })
  return data
}

export async function getBandarSnapshots(): Promise<{ tradeDate: string; count: number; rows: BandarSnapshotData[] }> {
  const { tradeDate, rows } = await loadBandarLatest()
  return { tradeDate, count: rows.length, rows }
}

export async function getBandarSnapshot(code: string): Promise<BandarSnapshotData | null> {
  const { rows } = await loadBandarLatest()
  return rows.find(r => r.code === code) ?? null
}

/** Strongest accumulation/distribution reads by top-1 concentration. */
export async function getBandarLeaders(
  dir: 'acc' | 'dist',
  limit = 20,
): Promise<BandarSnapshotData[]> {
  const { rows } = await loadBandarLatest()
  const scored = rows
    .filter(r => r.top1Amount !== null)
    .sort((a, b) =>
      dir === 'acc'
        ? (b.top1Amount ?? 0) - (a.top1Amount ?? 0)
        : (a.top1Amount ?? 0) - (b.top1Amount ?? 0),
    )
  return scored.slice(0, Math.min(100, Math.max(1, limit)))
}

export interface GuruScreenData {
  templateId: number
  templateName: string
  snapshotDate: string
  matches: Array<{ symbol: string; name: string; results: Array<Record<string, unknown>> }>
}

export async function getGuruScreens(): Promise<GuruScreenData[]> {
  const { data } = await getCached('stockbit-guru:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxStockbitGuru.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (!latest) return [] as GuruScreenData[]
    const dbRows = await prisma.idxStockbitGuru.findMany({
      where: { snapshotDate: latest.snapshotDate },
    })
    return dbRows.map(r => ({
      templateId: r.templateId,
      templateName: r.templateName,
      snapshotDate: r.snapshotDate,
      matches: (r.matches as GuruScreenData['matches']) ?? [],
    }))
  })
  return data
}

export interface AnalystRow {
  code: string
  recommendation: string
  buy: number
  sell: number
  hold: number
  total: number
  target: number | null
  low: number | null
  high: number | null
  updatedAt: string
}

export async function getAnalysts(): Promise<{ snapshotDate: string; count: number; rows: AnalystRow[] }> {
  const { data } = await getCached('stockbit-analyst:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxStockbitAnalyst.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (!latest) return { snapshotDate: '', rows: [] as AnalystRow[] }
    const dbRows = await prisma.idxStockbitAnalyst.findMany({
      where: { snapshotDate: latest.snapshotDate },
    })
    return {
      snapshotDate: latest.snapshotDate,
      rows: dbRows.map(r => ({
        code: r.code,
        recommendation: r.recommendation,
        buy: r.buy,
        sell: r.sell,
        hold: r.hold,
        total: r.total,
        target: r.target,
        low: r.low,
        high: r.high,
        updatedAt: r.updatedAt,
      })),
    }
  })
  return { ...data, count: data.rows.length }
}

export async function getAnalyst(code: string): Promise<AnalystRow | null> {
  const { rows } = await getAnalysts()
  return rows.find(r => r.code === code) ?? null
}
