// ─────────────────────────────────────────────────────────────
// IDX Signals provider — RS-check, breakout scan, bandar-flow
// signals composed from existing DB snapshots (zero new tables,
// zero upstream calls). SERVER-ONLY. Consume via /api/v1/saham/signals.
//
// Sources (all nightly harvests, read via their providers):
// - idx-screener (change4w/13w/26w/52w, high52w, price) → RS + breakout
// - idx-bandarmology streaks → foreign accumulation confirmation
// - idx-stockbit bandar snapshots (optional; 503-safe when absent)
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'
import { getScreenerSnapshot, type ScreenerRow } from '@/lib/modules/market/provider/idx-screener'
import { getForeignStreaks } from '@/lib/modules/market/provider/idx-bandarmology'
import { EmptySnapshotError } from '@/lib/modules/market/provider/idx-stockbit'

const CACHE_TTL = 10 * 60_000

export interface RSSignal {
  code: string
  name: string
  rs4w: number | null // change4w minus universe median (pp)
  rs13w: number | null
  rsScore: number // 0-100
}

export interface BreakoutSignal {
  code: string
  name: string
  price: number
  high52w: number
  distancePct: number // negative = below high (e.g. -3 = 3% below)
  volumeNote: string
}

export interface BandarFlowSignal {
  code: string
  accdist: string
  top1Amount: number | null
  foreignStreakDays: number
  foreignStreakDir: 'accumulation' | 'distribution' | null
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0
  const s = [...vals].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

interface UniverseCache {
  rows: ScreenerRow[]
  med4w: number
  med13w: number
}

async function loadUniverse(): Promise<UniverseCache> {
  const { data } = await getCached('idx-signals:universe:v1', CACHE_TTL, async () => {
    const snap = await getScreenerSnapshot()
    const rows = Object.values(snap.data)
    if (rows.length === 0) throw new EmptySnapshotError('IDX screener (signals)')
    const c4 = rows.map(r => num(r.change4w)).filter((v): v is number => v !== null)
    const c13 = rows.map(r => num(r.change13w)).filter((v): v is number => v !== null)
    return { rows, med4w: median(c4), med13w: median(c13) } as UniverseCache
  })
  return data
}

/** Relative-strength vs universe median (idxscreener rscheck concept).
 * Returns computed from IdxSahamSession closes (20 sessions ≈ 4w,
 * 60 sessions ≈ 13w) — the screener snapshot change columns are
 * unpopulated upstream, so RS never reads them. */
export interface SessionReturn { code: string; ret20: number | null; ret60: number | null }

async function loadSessionReturns(): Promise<{ rets: SessionReturn[]; med20: number; med60: number }> {
  const { data } = await getCached('idx-signals:sessionret:v1', CACHE_TTL, async () => {
    const rows = await prisma.idxSahamSession.findMany({
      orderBy: [{ code: 'asc' }, { tradeDate: 'desc' }],
      select: { code: true, close: true },
    })
    if (rows.length === 0) throw new EmptySnapshotError('IDX sessions (signals)')
    const byCode = new Map<string, number[]>()
    for (const r of rows) {
      if (!(r.close > 0)) continue
      let arr = byCode.get(r.code)
      if (!arr) { arr = []; byCode.set(r.code, arr) }
      arr.push(r.close)
    }
    const rets: SessionReturn[] = []
    const r20: number[] = []
    const r60: number[] = []
    for (const [code, closes] of byCode) {
      const last = closes[0]
      const ret = (n: number): number | null => {
        if (closes.length <= n || closes[n] <= 0) return null
        return ((last - closes[n]) / closes[n]) * 100
      }
      const v20 = ret(20)
      const v60 = ret(60)
      if (v20 === null && v60 === null) continue
      if (v20 !== null) r20.push(v20)
      if (v60 !== null) r60.push(v60)
      rets.push({ code, ret20: v20, ret60: v60 })
    }
    if (rets.length === 0) throw new EmptySnapshotError('IDX sessions (signals)')
    return { rets, med20: median(r20), med60: median(r60) }
  })
  return data
}

/** Relative-strength vs universe median, scored 0-100. */
export async function getRSSignals(limit = 20): Promise<{
  median4w: number
  median13w: number
  items: RSSignal[]
  names: Record<string, string>
}> {
  const { rets, med20, med60 } = await loadSessionReturns()
  const snap = await getScreenerSnapshot().catch(() => null)
  const names: Record<string, string> = {}
  if (snap) for (const r of Object.values(snap.data)) names[r.symbol] = r.name
  const items: RSSignal[] = []
  for (const r of rets) {
    const rs4 = r.ret20 === null ? null : r.ret20 - med20
    const rs13 = r.ret60 === null ? null : r.ret60 - med60
    const parts = [rs4, rs13].filter((v): v is number => v !== null)
    const avg = parts.reduce((a, b) => a + b, 0) / parts.length
    const rsScore = Math.max(0, Math.min(100, ((Math.max(-30, Math.min(30, avg)) + 30) / 60) * 100))
    items.push({ code: r.code, name: names[r.code] ?? r.code, rs4w: rs4, rs13w: rs13, rsScore })
  }
  items.sort((a, b) => b.rsScore - a.rsScore)
  return { median4w: med20, median13w: med60, items: items.slice(0, Math.min(100, Math.max(1, limit))), names }
}

/** Near-52w-high scan (idxscreener breakout concept). */
export async function getBreakoutSignals(
  withinPct = 5,
  limit = 20,
): Promise<{ thresholdPct: number; items: BreakoutSignal[] }> {
  const { rows } = await loadUniverse()
  const items: BreakoutSignal[] = []
  for (const r of rows) {
    const price = num(r.price)
    const high = num(r.high52w)
    if (price === null || high === null || high <= 0 || price > high) continue
    const distancePct = ((price - high) / high) * 100
    if (distancePct >= -Math.abs(withinPct)) {
      items.push({
        code: r.symbol,
        name: r.name,
        price,
        high52w: high,
        distancePct,
        volumeNote: num(r.volume) !== null ? 'volume in snapshot' : 'no volume',
      })
    }
  }
  items.sort((a, b) => b.distancePct - a.distancePct)
  return { thresholdPct: withinPct, items: items.slice(0, Math.min(100, Math.max(1, limit))) }
}

/** Bandar accumulation flow: Stockbit accdist × foreign streak (bandar-confirmed). */
export async function getBandarFlowSignals(limit = 20): Promise<{ items: BandarFlowSignal[] }> {
  const streaks = await getForeignStreaks(3, 500).catch(() => ({ accumulation: [], distribution: [] }))
  const streakByCode = new Map<string, { days: number; dir: 'accumulation' | 'distribution' | null }>()
  for (const s of [...(streaks.accumulation ?? []), ...(streaks.distribution ?? [])]) {
    streakByCode.set(s.code, { days: s.days ?? 0, dir: s.direction ?? null })
  }
  // Stockbit snapshot optional: absent (no harvest) → foreign-streak-only rows.
  let bandarRows: Array<{ code: string; accdist: string; top1Amount: number | null }> = []
  try {
    const { getBandarSnapshots } = await import('@/lib/modules/market/provider/idx-stockbit')
    const snap = await getBandarSnapshots()
    bandarRows = snap.rows.map(r => ({ code: r.code, accdist: r.accdist, top1Amount: r.top1Amount }))
  } catch (e) {
    if (!(e instanceof EmptySnapshotError)) throw e
  }
  const items: BandarFlowSignal[] = []
  const seen = new Set<string>()
  for (const b of bandarRows) {
    const st = streakByCode.get(b.code)
    items.push({
      code: b.code,
      accdist: b.accdist,
      top1Amount: b.top1Amount,
      foreignStreakDays: st?.days ?? 0,
      foreignStreakDir: st?.dir ?? null,
    })
    seen.add(b.code)
  }
  // Foreign accumulation without Stockbit coverage still signals.
  for (const s of streaks.accumulation ?? []) {
    if (seen.has(s.code)) continue
    items.push({
      code: s.code,
      accdist: 'unknown',
      top1Amount: null,
      foreignStreakDays: s.days ?? 0,
      foreignStreakDir: 'accumulation',
    })
  }
  // Rank: accumulation first (accdist Acc* + streak), then by streak days.
  const rank = (i: BandarFlowSignal): number =>
    (i.foreignStreakDir === 'accumulation' ? 1000 : 0) +
    (/acc/i.test(i.accdist) ? 500 : 0) +
    Math.min(i.foreignStreakDays, 30)
  items.sort((a, b) => rank(b) - rank(a))
  return { items: items.slice(0, Math.min(100, Math.max(1, limit))) }
}
