// ─────────────────────────────────────────────────────────────
// IDX Bandarmology Provider — foreign-flow + broker-board
// analytics computed from Prisma (IdxSahamSession, IdxBrokerBoard,
// IdxScreenerSnapshot). NO upstream calls at runtime.
//
// SERVING PATTERN: parsed datasets live in a process-lifetime
// singleton invalidated by snapshot date. Sorts are computed once
// per snapshot — per-request work collapses to slices over prebuilt
// arrays.
//
// SERVER-ONLY. Consume via /api/v1/saham/bandarmology.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface ForeignLeader {
  code: string
  name: string
  close: number
  changePct: number
  fbuyVol: number
  fsellVol: number
  netVol: number
  estNetValueIdr: number
}

export interface ForeignStreak extends ForeignLeader {
  days: number
  direction: 'accumulation' | 'distribution'
}

export interface SahamMeta {
  tradeDate: string
  capturedAt: string
  count: number
  historySessions?: number
}

export interface MarketFlowPoint {
  date: string
  buyVol: number
  sellVol: number
  netVol: number
  netValueIdr: number
}

export interface SectorRotationRow {
  sector: string
  netValueIdr: number
  inflowStocks: number
  outflowStocks: number
}

interface BandarCache {
  sig: string
  latestParsed: { capturedAt: string; tradeDate: string; count: number }
  tradeDate: string
  leadersAll: ForeignLeader[]
  leadersByValueAsc: ForeignLeader[]
  brokerRowsByValueDesc: Array<{ firm: string; name: string; volume: number; value: number; freq: number }>
  rotation: SectorRotationRow[]
  rotationTradeDate: string
  marketFlow: MarketFlowPoint[]
  historySessions: number
}

let cache: BandarCache | null = null

function toLeader(r: {
  code: string
  name: string
  prev: number
  close: number
  change: number
  foreignBuy: number
  foreignSell: number
}): ForeignLeader {
  const netVol = r.foreignBuy - r.foreignSell
  return {
    code: r.code,
    name: r.name,
    close: r.close,
    changePct: r.prev > 0 ? ((r.close - r.prev) / r.prev) * 100 : 0,
    fbuyVol: r.foreignBuy,
    fsellVol: r.foreignSell,
    netVol,
    estNetValueIdr: netVol * r.close,
  }
}

async function buildCache(): Promise<BandarCache> {
  // Latest session date
  const latest = await prisma.idxSahamSession.findFirst({
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  })
  if (!latest) {
    return {
      sig: '',
      latestParsed: { capturedAt: '', tradeDate: '', count: 0 },
      tradeDate: '',
      leadersAll: [],
      leadersByValueAsc: [],
      brokerRowsByValueDesc: [],
      rotation: [],
      rotationTradeDate: '',
      marketFlow: [],
      historySessions: 0,
    }
  }
  const tradeDate = latest.tradeDate

  // Latest session rows
  const sessionRows = await prisma.idxSahamSession.findMany({ where: { tradeDate } })
  const leadersAll = sessionRows.map(toLeader)
  const leadersByValueAsc = [...leadersAll]
    .filter((l) => l.fbuyVol > 0 || l.fsellVol > 0)
    .sort((a, b) => a.estNetValueIdr - b.estNetValueIdr)

  // Sector mapping from screener snapshot
  const latestScreener = await prisma.idxScreenerSnapshot.findFirst({
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true },
  })
  const sectorByCode = new Map<string, string>()
  if (latestScreener) {
    const screenerRows = await prisma.idxScreenerSnapshot.findMany({
      where: { snapshotDate: latestScreener.snapshotDate },
      select: { code: true, sector: true },
    })
    for (const r of screenerRows) sectorByCode.set(r.code, r.sector || 'Unknown')
  }

  // Sector rotation
  const acc = new Map<string, { netValueIdr: number; inflowStocks: number; outflowStocks: number }>()
  for (const l of leadersAll) {
    if (l.netVol === 0) continue
    const sector = sectorByCode.get(l.code) ?? 'Unknown'
    const cur = acc.get(sector) ?? { netValueIdr: 0, inflowStocks: 0, outflowStocks: 0 }
    cur.netValueIdr += l.estNetValueIdr
    if (l.netVol > 0) cur.inflowStocks++
    else cur.outflowStocks++
    acc.set(sector, cur)
  }
  const rotation: SectorRotationRow[] = [...acc.entries()]
    .map(([sector, v]) => ({ sector, ...v }))
    .sort((a, b) => Math.abs(b.netValueIdr) - Math.abs(a.netValueIdr))

  // Market flow: last 90 sessions
  const distinctDates = await prisma.idxSahamSession.findMany({
    distinct: ['tradeDate'],
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
    take: 90,
  })
  const dates = distinctDates.map((d) => d.tradeDate).sort()
  const marketFlow: MarketFlowPoint[] = []
  for (const date of dates) {
    const rows = await prisma.idxSahamSession.findMany({
      where: { tradeDate: date },
      select: { foreignBuy: true, foreignSell: true, close: true },
    })
    let buyVol = 0
    let sellVol = 0
    let netValueIdr = 0
    for (const r of rows) {
      buyVol += r.foreignBuy
      sellVol += r.foreignSell
      netValueIdr += (r.foreignBuy - r.foreignSell) * r.close
    }
    marketFlow.push({ date, buyVol, sellVol, netVol: buyVol - sellVol, netValueIdr })
  }

  // Broker board
  const brokers = await prisma.idxBrokerBoard.findMany({ where: { tradeDate } })
  const brokerRowsByValueDesc = [...brokers]
    .map((b) => ({ firm: b.firm, name: b.name, volume: b.volume, value: b.value, freq: b.freq }))
    .sort((a, b) => b.value - a.value)

  return {
    sig: tradeDate,
    latestParsed: { capturedAt: tradeDate, tradeDate, count: sessionRows.length },
    tradeDate,
    leadersAll,
    leadersByValueAsc,
    brokerRowsByValueDesc,
    rotation,
    rotationTradeDate: tradeDate,
    marketFlow,
    historySessions: dates.length,
  }
}

async function getCache(): Promise<BandarCache> {
  const latest = await prisma.idxSahamSession.findFirst({
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  })
  const sig = latest?.tradeDate ?? ''
  if (!cache || cache.sig !== sig) {
    cache = await buildCache()
  }
  return cache
}

/** Top foreign net-buy / net-sell stocks for the latest session. */
export async function getForeignLeaders(limit = 20): Promise<{
  meta: SahamMeta
  topBuy: ForeignLeader[]
  topSell: ForeignLeader[]
}> {
  const c = await getCache()
  const asc = c.leadersByValueAsc.filter((l) => l.netVol !== 0)
  return {
    meta: { ...c.latestParsed, historySessions: c.historySessions },
    topBuy: asc.slice(-limit).reverse(),
    topSell: asc.slice(0, limit),
  }
}

/** Consecutive-session foreign accumulation/distribution streaks. */
const streakMemo = new Map<string, { days: number; dir: 'accumulation' | 'distribution' | null }>()
let streakMemoSig = ''

export async function getForeignStreaks(minDays = 3, limit = 25): Promise<{
  meta: SahamMeta & { sessionsUsed: number }
  accumulation: ForeignStreak[]
  distribution: ForeignStreak[]
}> {
  const c = await getCache()
  if (streakMemoSig !== c.sig) {
    streakMemo.clear()
    streakMemoSig = c.sig
  }

  // Get last 30 session dates
  const distinctDates = await prisma.idxSahamSession.findMany({
    distinct: ['tradeDate'],
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
    take: 30,
  })
  const dates = distinctDates.map((d) => d.tradeDate).sort()

  // Build a map: code → date → { fbuy, fsell, close }
  const sessionMap = new Map<string, Map<string, { fbuy: number; fsell: number; close: number }>>()
  for (const date of dates) {
    const rows = await prisma.idxSahamSession.findMany({
      where: { tradeDate: date },
      select: { code: true, foreignBuy: true, foreignSell: true, close: true },
    })
    for (const r of rows) {
      let m = sessionMap.get(r.code)
      if (!m) {
        m = new Map()
        sessionMap.set(r.code, m)
      }
      m.set(date, { fbuy: r.foreignBuy, fsell: r.foreignSell, close: r.close })
    }
  }

  const streakOf = (code: string): { days: number; dir: 'accumulation' | 'distribution' | null } => {
    const hit = streakMemo.get(code)
    if (hit) return hit
    let days = 0
    let dir: 'accumulation' | 'distribution' | null = null
    for (let i = dates.length - 1; i >= 0; i--) {
      const s = sessionMap.get(code)?.get(dates[i])
      if (!s) break
      const net = s.fbuy - s.fsell
      if (net === 0) break
      const cur: 'accumulation' | 'distribution' = net > 0 ? 'accumulation' : 'distribution'
      if (dir === null) dir = cur
      else if (cur !== dir) break
      days++
    }
    const out = { days, dir }
    streakMemo.set(code, out)
    return out
  }

  const withStreaks: ForeignStreak[] = []
  for (const l of c.leadersAll) {
    const st = streakOf(l.code)
    if (st.dir && st.days >= minDays) withStreaks.push({ ...l, days: st.days, direction: st.dir })
  }
  const acc = withStreaks.filter((s) => s.direction === 'accumulation').sort((a, b) => b.days - a.days || b.estNetValueIdr - a.estNetValueIdr).slice(0, limit)
  const dist = withStreaks.filter((s) => s.direction === 'distribution').sort((a, b) => b.days - a.days || a.estNetValueIdr - b.estNetValueIdr).slice(0, limit)
  return {
    meta: { ...c.latestParsed, historySessions: c.historySessions, sessionsUsed: dates.length },
    accumulation: acc,
    distribution: dist,
  }
}

/** Per-symbol daily foreign-net series (oldest→newest). */
export async function getForeignSeries(symbol: string, days = 30): Promise<{
  symbol: string
  series: Array<{ date: string; fbuy: number; fsell: number; net: number; cum: number; close: number }>
} | null> {
  const code = symbol.replace('.JK', '').toUpperCase()
  const distinctDates = await prisma.idxSahamSession.findMany({
    distinct: ['tradeDate'],
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
    take: days,
  })
  const dates = distinctDates.map((d) => d.tradeDate).sort()

  let cum = 0
  const series: Array<{ date: string; fbuy: number; fsell: number; net: number; cum: number; close: number }> = []
  for (const date of dates) {
    const row = await prisma.idxSahamSession.findUnique({
      where: { code_tradeDate: { code, tradeDate: date } },
      select: { foreignBuy: true, foreignSell: true, close: true },
    })
    if (!row) continue
    const net = row.foreignBuy - row.foreignSell
    cum += net
    series.push({ date, fbuy: row.foreignBuy, fsell: row.foreignSell, net, cum, close: row.close })
  }
  if (series.length === 0) return null
  return { symbol: `${code}.JK`, series }
}

/** Market-wide broker board ranked by turnover. */
export async function getBrokerBoard(limit = 25): Promise<{
  tradeDate: string
  rows: Array<{ firm: string; name: string; volume: number; value: number; freq: number }>
}> {
  const c = await getCache()
  return {
    tradeDate: c.tradeDate,
    rows: c.brokerRowsByValueDesc.slice(0, limit),
  }
}

/** Market-wide foreign-flow timeline (prebuilt once per snapshot). */
export async function getMarketFlow(): Promise<{
  tradeDate: string
  sessions: MarketFlowPoint[]
}> {
  const c = await getCache()
  return { tradeDate: c.tradeDate, sessions: c.marketFlow }
}

/** Sector-level foreign-flow rotation for the latest session (prebuilt). */
export async function getSectorRotation(): Promise<{
  tradeDate: string
  sectors: SectorRotationRow[]
}> {
  const c = await getCache()
  return { tradeDate: c.rotationTradeDate, sectors: c.rotation }
}
