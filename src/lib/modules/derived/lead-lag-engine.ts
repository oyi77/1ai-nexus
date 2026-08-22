// ─────────────────────────────────────────────────────────────
// DEX/CEX Lead-Lag Matrix
// Measures repricing latency between DEX (dexscreener) and CEX
// (coingecko) price streams for the same asset, using the unified
// MarketSnapshot tick store from P0. Cross-correlates minute-bucketed
// returns and records the lag with peak correlation. Persists to
// LeadLagMatrix for the ranker (P5).
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

const DEX_SOURCE = 'dex:dexscreener'
const CEX_SOURCE = 'cex:coingecko'
const MAX_LAG = 10 // minutes
const SAMPLE = 600

interface Bucketed {
  t: number // minute epoch
  ret: number
}

function bucketReturns(rows: { price: number; timestamp: Date }[]): Bucketed[] {
  const byMin = new Map<number, number[]>()
  for (const r of rows) {
    const m = Math.floor(r.timestamp.getTime() / 60_000)
    const arr = byMin.get(m) ?? []
    arr.push(r.price)
    byMin.set(m, arr)
  }
  const series: Bucketed[] = []
  let prevAvg: number | null = null
  const sorted = [...byMin.entries()].sort((a, b) => a[0] - b[0])
  for (const [m, prices] of sorted) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length
    if (prevAvg != null && prevAvg > 0) series.push({ t: m, ret: (avg - prevAvg) / prevAvg })
    prevAvg = avg
  }
  return series
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  let sa = 0, sb = 0
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i] }
  const ma = sa / n, mb = sb / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb
    num += xa * xb; da += xa * xa; db += xb * xb
  }
  const den = Math.sqrt(da * db)
  return den === 0 ? 0 : num / den
}

// Compute lead-lag for one asset. Returns null if insufficient data.
export async function computeLeadLag(asset: string): Promise<{
  asset: string
  dexVenue: string
  cexVenue: string
  bestLagMinutes: number
  correlation: number
  sampleSize: number
} | null> {
  const [dexRows, cexRows] = await Promise.all([
    prisma.marketSnapshot.findMany({ where: { symbol: asset, sourceId: DEX_SOURCE }, orderBy: { timestamp: 'desc' }, take: SAMPLE }),
    prisma.marketSnapshot.findMany({ where: { symbol: asset, sourceId: CEX_SOURCE }, orderBy: { timestamp: 'desc' }, take: SAMPLE }),
  ])
  if (dexRows.length < 10 || cexRows.length < 10) return null

  const dex = bucketReturns(dexRows.map((r) => ({ price: r.price, timestamp: r.timestamp }))).reverse()
  const cex = bucketReturns(cexRows.map((r) => ({ price: r.price, timestamp: r.timestamp }))).reverse()

  let bestLag = 0
  let bestCorr = -1
  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag++) {
    let a: number[], b: number[]
    if (lag >= 0) {
      a = dex.slice(lag); b = cex.slice(0, cex.length - lag)
    } else {
      a = dex.slice(0, dex.length + lag); b = cex.slice(-lag)
    }
    if (a.length < 3 || b.length < 3) continue
    const c = Math.abs(pearson(a, b))
    if (c > bestCorr) { bestCorr = c; bestLag = lag }
  }
  if (bestCorr < 0) return null

  return {
    asset,
    dexVenue: DEX_SOURCE,
    cexVenue: CEX_SOURCE,
    bestLagMinutes: bestLag,
    correlation: Math.round(bestCorr * 1000) / 1000,
    sampleSize: Math.min(dex.length, cex.length),
  }
}

export async function computeAndStoreLeadLag(asset: string) {
  const res = await computeLeadLag(asset)
  if (!res) return 0
  await prisma.leadLagMatrix.upsert({
    where: { asset_dexVenue_cexVenue: { asset: res.asset, dexVenue: res.dexVenue, cexVenue: res.cexVenue } },
    create: res,
    update: { bestLagMinutes: res.bestLagMinutes, correlation: res.correlation, sampleSize: res.sampleSize, computedAt: new Date() },
  })
  return 1
}

export async function fetchLeadLag(asset?: string) {
  const rows = await prisma.leadLagMatrix.findMany({
    where: asset ? { asset } : {},
    orderBy: { correlation: 'desc' },
    take: 50,
  })
  return rows
}
