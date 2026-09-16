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
import { getForeignStreaks, getSectorRotation } from '@/lib/modules/market/provider/idx-bandarmology'
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
  return { median4w: med20, median13w: med60, items: items.slice(0, Math.min(1000, Math.max(1, limit))), names }
}

/** ARA proximity (BEI symmetric bands, per Kompas 2026-08-20 citing BEI/Stockbit —
 * still current as of 2026-09-16; reclassification under review, not in force):
 * Rp1–10: nominal Rp1 · Rp11–200: 35% · Rp201–5000: 25% · >Rp5000: 20%.
 * ARB 15% all tiers. ARA computed from previous close, floored to IDX tick
 * (<200:1 · <500:2 · <2000:5 · <5000:10 · else 25). proximityPct = room to
 * ARA from latest close; small = near limit-up. */
export function araRate(prev: number): number {
  if (!(prev > 0)) return 0
  if (prev <= 10) return 0 // nominal Rp1 band — handled by caller
  if (prev <= 200) return 0.35
  if (prev <= 5000) return 0.25
  return 0.2
}

export function idxTick(price: number): number {
  if (price < 200) return 1
  if (price < 500) return 2
  if (price < 2000) return 5
  if (price < 5000) return 10
  return 25
}

export interface ARAProximity {
  code: string
  name: string
  prev: number
  close: number
  ara: number
  proximityPct: number
}

export async function getARAProximity(limit = 20): Promise<{ tradeDate: string; items: ARAProximity[] }> {
  const { data } = await getCached('idx-signals:ara:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxSahamSession.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) throw new EmptySnapshotError('IDX sessions (ARA)')
    const rows = await prisma.idxSahamSession.findMany({
      where: { tradeDate: latest.tradeDate },
      select: { code: true, prev: true, close: true },
    })
    const snap = await getScreenerSnapshot().catch(() => null)
    const names: Record<string, string> = {}
    if (snap) for (const r of Object.values(snap.data)) names[r.symbol] = r.name
    const items: ARAProximity[] = []
    for (const r of rows) {
      if (!(r.prev > 0) || !(r.close > 0)) continue
      const rate = araRate(r.prev)
      const raw = rate === 0 ? r.prev + 1 : r.prev * (1 + rate)
      const tick = idxTick(raw)
      const ara = Math.floor(raw / tick) * tick
      if (ara <= r.close) continue // already at/past limit (halted or data lag)
      items.push({
        code: r.code,
        name: names[r.code] ?? r.code,
        prev: r.prev,
        close: r.close,
        ara,
        proximityPct: ((ara - r.close) / r.close) * 100,
      })
    }
    if (items.length === 0) throw new EmptySnapshotError('IDX sessions (ARA)')
    items.sort((a, b) => a.proximityPct - b.proximityPct)
    return { tradeDate: latest.tradeDate, items }
  })
  const lim = Math.min(1000, Math.max(1, limit))
  return { tradeDate: data.tradeDate, items: data.items.slice(0, lim) }
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
  return { thresholdPct: withinPct, items: items.slice(0, Math.min(1000, Math.max(1, limit))) }
}

/** Backtest RS/breakout/ARA picks against session closes.
 * Lookahead-free by construction: signal at session index i uses only
 * closes[..i]; forward return measured i → i+horizon. In-sample
 * (62 sessions ≈ 3 months) — direction check, not a full backtest.
 * Bandar lane excluded (1 snapshot day; needs history to accumulate). */
export interface BacktestRow {
  lane: 'rs' | 'breakout' | 'ara'
  code: string
  signalDate: string
  horizon: number
  retPct: number | null
}

export async function backtestSignals(
  lane: 'rs' | 'breakout' | 'ara',
  topN = 10,
  horizon = 5,
): Promise<{ signals: number; evaluated: number; winRate: number | null; avgRet: number | null; rows: BacktestRow[] }> {
  const sessions = await prisma.idxSahamSession.findMany({
    orderBy: [{ code: 'asc' }, { tradeDate: 'asc' }],
    select: { code: true, tradeDate: true, close: true, high: true },
  })
  if (sessions.length === 0) throw new EmptySnapshotError('IDX sessions (backtest)')
  const byCode = new Map<string, Array<{ date: string; close: number; high: number }>>()
  for (const r of sessions) {
    if (!(r.close > 0)) continue
    let arr = byCode.get(r.code)
    if (!arr) { arr = []; byCode.set(r.code, arr) }
    arr.push({ date: r.tradeDate, close: r.close, high: r.high > 0 ? r.high : r.close })
  }
  const dates = [...new Set(sessions.map(r => r.tradeDate))].sort()
  const rows: BacktestRow[] = []
  // Evaluate on ~4 weekly checkpoints to bound compute.
  const checkpoints = dates.filter((_, i) => i % 5 === 4 && i + horizon < dates.length).slice(-12)
  for (const date of checkpoints) {
    // universe median return over lookback using data ≤ idx
    const rets20: number[] = []
    const perCode = new Map<string, { r20: number | null; px: number; hi: number }>()
    for (const [code, arr] of byCode) {
      const upto = arr.filter(p => p.date <= date)
      if (upto.length < 21) continue
      const last = upto[upto.length - 1]
      const r20 = ((last.close - upto[upto.length - 21].close) / upto[upto.length - 21].close) * 100
      rets20.push(r20)
      perCode.set(code, { r20, px: last.close, hi: last.high })
    }
    if (perCode.size === 0) continue
    const med = median(rets20)
    let picks: Array<{ code: string }> = []
    if (lane === 'rs') {
      picks = [...perCode.entries()]
        .map(([code, v]) => ({ code, s: v.r20 === null ? -Infinity : v.r20 - med }))
        .sort((a, b) => b.s - a.s)
        .slice(0, topN)
    } else if (lane === 'breakout') {
      // proximity to trailing-60-session high using data ≤ idx
      picks = [...byCode.entries()]
        .map(([code, arr]) => {
          const upto = arr.filter(p => p.date <= date).slice(-60)
          if (upto.length < 20) return null
          const hi = Math.max(...upto.map(p => p.high))
          const last = upto[upto.length - 1].close
          const d = ((last - hi) / hi) * 100
          return d <= 0 && d >= -5 ? { code } : null
        })
        .filter((x): x is { code: string } => x !== null)
        .slice(0, topN)
    } else {
      // ARA proximity from prev close (session before date)
      picks = [...byCode.entries()]
        .map(([code, arr]) => {
          const upto = arr.filter(p => p.date <= date)
          if (upto.length < 2) return null
          const prev = upto[upto.length - 2].close
          const last = upto[upto.length - 1].close
          if (!(prev > 0)) return null
          const rate = prev <= 10 ? 0 : prev <= 200 ? 0.35 : prev <= 5000 ? 0.25 : 0.2
          const ara = rate === 0 ? prev + 1 : prev * (1 + rate)
          if (ara <= last) return null
          return { code, prox: ((ara - last) / last) * 100 }
        })
        .filter((x): x is { code: string; prox: number } => x !== null)
        .sort((a, b) => a.prox - b.prox)
        .slice(0, topN)
    }
    for (const p of picks) {
      const arr = byCode.get(p.code)!
      const i0 = arr.findIndex(x => x.date === date)
      const fwd = arr[i0 + horizon]
      const base = arr[i0]
      rows.push({
        lane,
        code: p.code,
        signalDate: date,
        horizon,
        retPct: fwd && base.close > 0 ? ((fwd.close - base.close) / base.close) * 100 : null,
      })
    }
  }
  const ev = rows.filter(r => r.retPct !== null)
  const wins = ev.filter(r => (r.retPct as number) > 0)
  return {
    signals: rows.length,
    evaluated: ev.length,
    winRate: ev.length > 0 ? (wins.length / ev.length) * 100 : null,
    avgRet: ev.length > 0 ? ev.reduce((a, r) => a + (r.retPct as number), 0) / ev.length : null,
    rows,
  }
}

/** Sector money flow: bandar top-1 amounts aggregated by IDX sector
 * (sector from screener snapshot). Positive = net accumulation. */
export interface SectorFlowRow {
  sector: string
  codes: number
  netTop1: number
  acc: number
  dist: number
}

export async function getSectorFlow(): Promise<{ tradeDate: string; sectors: SectorFlowRow[] }> {
  const { data } = await getCached('idx-signals:sectorflow:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxBandarSnapshot.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) throw new EmptySnapshotError('Stockbit bandar (sector flow)')
    const screenerLatest = await prisma.idxScreenerSnapshot.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    }).catch(() => null)
    const [bandarRows, screenerRows] = await Promise.all([
      prisma.idxBandarSnapshot.findMany({ where: { tradeDate: latest.tradeDate } }),
      (screenerLatest
        ? prisma.idxScreenerSnapshot.findMany({
            where: { snapshotDate: screenerLatest.snapshotDate },
            select: { code: true, sector: true },
          })
        : Promise.resolve([] as Array<{ code: string; sector: string }>)).catch(
        () => [] as Array<{ code: string; sector: string }>,
      ),
    ])
    const sectorByCode = new Map(screenerRows.map(r => [r.code, r.sector || 'Unknown']))
    const agg = new Map<string, { codes: number; net: number; acc: number; dist: number }>()
    for (const b of bandarRows) {
      const sector = sectorByCode.get(b.code) ?? 'Unknown'
      const e = agg.get(sector) ?? { codes: 0, net: 0, acc: 0, dist: 0 }
      e.codes++
      e.net += b.top1Amount ?? 0
      if (/acc/i.test(b.accdist)) e.acc++
      else if (/dist/i.test(b.accdist)) e.dist++
      agg.set(sector, e)
    }
    const sectors: SectorFlowRow[] = [...agg.entries()].map(([sector, e]) => ({
      sector,
      codes: e.codes,
      netTop1: e.net,
      acc: e.acc,
      dist: e.dist,
    }))
    sectors.sort((a, b) => b.netTop1 - a.netTop1)
    return { tradeDate: latest.tradeDate, sectors }
  })
  return data
}

/** Sector × bandar money-flow matrix: foreign rotation net value per sector
 * joined with Stockbit bandar accdist counts per sector. Ranks sectors by
 * combined accumulation pressure. */
export interface SectorBandarRow {
  sector: string
  foreignNetIdr: number | null
  inflowStocks: number
  outflowStocks: number
  bandarAcc: number
  bandarDist: number
  score: number
}

export async function getSectorBandarMatrix(): Promise<{ tradeDate: string; items: SectorBandarRow[] }> {
  const { data } = await getCached('idx-signals:sectormatrix:v1', CACHE_TTL, async () => {
    const [rotation, bandar] = await Promise.all([
      getSectorRotation().catch(() => null),
      (async () => {
        try {
          const { getBandarSnapshots } = await import('@/lib/modules/market/provider/idx-stockbit')
          return await getBandarSnapshots()
        } catch (e) {
          if (e instanceof EmptySnapshotError) return null
          throw e
        }
      })(),
    ])
    const snap = await getScreenerSnapshot().catch(() => null)
    const sectorByCode = new Map<string, string>()
    if (snap) for (const r of Object.values(snap.data)) sectorByCode.set(r.symbol, r.sector || 'Unknown')
    const acc = new Map<string, SectorBandarRow>()
    const ensure = (sector: string): SectorBandarRow => {
      let row = acc.get(sector)
      if (!row) {
        row = { sector, foreignNetIdr: null, inflowStocks: 0, outflowStocks: 0, bandarAcc: 0, bandarDist: 0, score: 0 }
        acc.set(sector, row)
      }
      return row
    }
    for (const s of rotation?.sectors ?? []) {
      const row = ensure(s.sector)
      row.foreignNetIdr = typeof s.netValueIdr === 'number' ? s.netValueIdr : null
      row.inflowStocks = s.inflowStocks ?? 0
      row.outflowStocks = s.outflowStocks ?? 0
    }
    for (const b of bandar?.rows ?? []) {
      const sector = sectorByCode.get(b.code) ?? 'Unknown'
      const row = ensure(sector)
      if (/acc/i.test(b.accdist)) row.bandarAcc++
      else if (/dist/i.test(b.accdist)) row.bandarDist++
    }
    const items = [...acc.values()].map(r => ({
      ...r,
      score: (r.foreignNetIdr !== null && r.foreignNetIdr > 0 ? 50 : 0) + (r.bandarAcc - r.bandarDist) * 5,
    }))
    items.sort((a, b) => b.score - a.score)
    if (items.length === 0) throw new EmptySnapshotError('sector-bandar')
    return { tradeDate: rotation?.tradeDate ?? bandar?.tradeDate ?? '', items }
  })
  return data
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
  return { items: items.slice(0, Math.min(1000, Math.max(1, limit))) }
}
