// ─────────────────────────────────────────────────────────────
// IDX Bandarmology Provider — foreign-flow + broker-board
// analytics computed from harvested snapshots (NO upstream calls
// at runtime; all reads hit data/idx/*.json).
//
// Snapshots written by src/scripts/idx-saham-harvest.ts:
//   saham-latest.json     latest session rows (OHLCV+foreign)
//   foreign-history.json  rolling 90-session foreign flows
//   brokers-latest.json   market broker board
//
// SERVING PATTERN: parsed datasets live in a process-lifetime
// singleton invalidated by source mtimes (cron refreshes are
// picked up on the next call). Sorts are computed once per
// snapshot — per-request work collapses to slices over prebuilt
// arrays.
//
// SERVER-ONLY (node:fs). Consume via /api/v1/saham/bandarmology.
// ─────────────────────────────────────────────────────────────

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const DIR = join(process.cwd(), 'data', 'idx')

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

const LatestSchema = z.object({
  capturedAt: z.string(),
  tradeDate: z.string(),
  count: z.number(),
  rows: z.array(z.object({
    code: z.string(),
    name: z.string(),
    prev: z.number(),
    close: z.number(),
    change: z.number(),
    volume: z.number(),
    value: z.number(),
    freq: z.number(),
    foreignBuy: z.number(),
    foreignSell: z.number(),
  })),
}).loose()

const HistorySchema = z.object({
  sessions: z.array(z.object({
    date: z.string(),
    stocks: z.record(z.string(), z.object({ fbuy: z.number(), fsell: z.number(), close: z.number() })),
  })),
})

const BrokersSchema = z.object({
  capturedAt: z.string(),
  tradeDate: z.string(),
  rows: z.array(z.object({ firm: z.string(), name: z.string(), volume: z.number(), value: z.number(), freq: z.number() })),
})

export interface SahamMeta {
  tradeDate: string
  capturedAt: string
  count: number
  historySessions?: number
}

type LatestRow = z.infer<typeof LatestSchema>['rows'][number]

interface BandarCache {
  mtimes: string
  latestParsed: { capturedAt: string; tradeDate: string; count: number }
  history: z.infer<typeof HistorySchema>
  brokersTradeDate: string
  leadersAll: ForeignLeader[]
  leadersByValueAsc: ForeignLeader[]
  brokerRowsByValueDesc: z.infer<typeof BrokersSchema>['rows']
  /** Sector-level foreign-flow rollup, |net| desc — prebuilt per snapshot. */
  rotation: SectorRotationRow[]
  rotationTradeDate: string
  /** Market-wide foreign flow per session — prebuilt once per snapshot. */
  marketFlow: MarketFlowPoint[]
}

export interface MarketFlowPoint {
  date: string
  buyVol: number
  sellVol: number
  netVol: number
  /** Σ(net volume × close) across stocks with activity that session. */
  netValueIdr: number
}

export interface SectorRotationRow {
  sector: string
  netValueIdr: number
  inflowStocks: number
  outflowStocks: number
}

let cache: BandarCache | null = null

function toLeader(r: LatestRow): ForeignLeader {
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

async function mtimeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs
  } catch {
    return -1
  }
}

async function buildCache(): Promise<BandarCache> {
  const [latestRaw, historyRaw, brokersRaw, universeRaw] = await Promise.all([
    readFile(join(DIR, 'saham-latest.json'), 'utf8'),
    readFile(join(DIR, 'foreign-history.json'), 'utf8'),
    readFile(join(DIR, 'brokers-latest.json'), 'utf8'),
    readFile(join(DIR, 'universe.json'), 'utf8').catch(() => null),
  ])
  const latest = LatestSchema.parse(JSON.parse(latestRaw))
  const history = HistorySchema.parse(JSON.parse(historyRaw))
  const brokers = BrokersSchema.parse(JSON.parse(brokersRaw))

  // code → sector from the universe snapshot (rotation cross-reference).
  const sectorByCode = new Map<string, string>()
  if (universeRaw) {
    const universe = JSON.parse(universeRaw) as { stocks?: Array<{ symbol: string; sector?: string }> }
    for (const s of universe.stocks ?? []) {
      sectorByCode.set(s.symbol.replace('.JK', ''), s.sector ?? 'Unknown')
    }
  }
  const leadersAll = latest.rows.map(toLeader)
  const leadersByValueAsc = [...leadersAll]
    .filter((l) => l.fbuyVol > 0 || l.fsellVol > 0)
    .sort((a, b) => a.estNetValueIdr - b.estNetValueIdr)

  // Precomputed sector rotation: foreign net value aggregated by universe
  // sector, |net| desc — O(rows) once per snapshot instead of per request.
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

  // Market-wide flow per session: Σ foreign volumes + net-value estimate.
  // O(sessions × stocks) once per snapshot (~90 × 1k).
  const marketFlow: MarketFlowPoint[] = history.sessions.map((s) => {
    let buyVol = 0
    let sellVol = 0
    let netValueIdr = 0
    for (const e of Object.values(s.stocks)) {
      buyVol += e.fbuy
      sellVol += e.fsell
      netValueIdr += (e.fbuy - e.fsell) * e.close
    }
    return { date: s.date, buyVol, sellVol, netVol: buyVol - sellVol, netValueIdr }
  })

  return {
    mtimes: '',
    latestParsed: { capturedAt: latest.capturedAt, tradeDate: latest.tradeDate, count: latest.count },
    history,
    brokersTradeDate: brokers.tradeDate,
    leadersAll,
    leadersByValueAsc,
    brokerRowsByValueDesc: [...brokers.rows].sort((a, b) => b.value - a.value),
    rotation,
    rotationTradeDate: latest.tradeDate,
    marketFlow,
  }
}

/** Singleton access; rebuilds only when any source file's mtime changes. */
async function getCache(): Promise<BandarCache> {
  const [m1, m2, m3] = await Promise.all([
    mtimeOf(join(DIR, 'saham-latest.json')),
    mtimeOf(join(DIR, 'foreign-history.json')),
    mtimeOf(join(DIR, 'brokers-latest.json')),
  ])
  const sig = `${m1}:${m2}:${m3}`
  if (!cache || cache.mtimes !== sig) {
    cache = await buildCache()
    cache.mtimes = sig
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
    meta: { ...c.latestParsed, historySessions: c.history.sessions.length },
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
  if (streakMemoSig !== c.mtimes) {
    streakMemo.clear()
    streakMemoSig = c.mtimes
  }
  const sessions = c.history.sessions.slice(-30)
  const streakOf = (code: string): { days: number; dir: 'accumulation' | 'distribution' | null } => {
    const hit = streakMemo.get(code)
    if (hit) return hit
    let days = 0
    let dir: 'accumulation' | 'distribution' | null = null
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i].stocks[code]
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
    meta: { ...c.latestParsed, historySessions: c.history.sessions.length, sessionsUsed: sessions.length },
    accumulation: acc,
    distribution: dist,
  }
}

/** Per-symbol daily foreign-net series (oldest→newest). */
export async function getForeignSeries(symbol: string, days = 30): Promise<{
  symbol: string
  series: Array<{ date: string; fbuy: number; fsell: number; net: number; cum: number; close: number }>
} | null> {
  const c = await getCache()
  const code = symbol.replace('.JK', '').toUpperCase()
  let cum = 0
  const series = c.history.sessions
    .slice(-days)
    .map((s) => {
      const e = s.stocks[code]
      if (!e) return null
      const net = e.fbuy - e.fsell
      cum += net
      return { date: s.date, fbuy: e.fbuy, fsell: e.fsell, net, cum, close: e.close }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  if (series.length === 0) return null
  return { symbol: `${code}.JK`, series }
}

/** Market-wide broker board ranked by turnover. */
export async function getBrokerBoard(limit = 25): Promise<{
  tradeDate: string
  rows: Array<z.infer<typeof BrokersSchema>['rows'][number]>
}> {
  const c = await getCache()
  return {
    tradeDate: c.brokersTradeDate,
    rows: c.brokerRowsByValueDesc.slice(0, limit),
  }
}

/** Market-wide foreign-flow timeline (prebuilt once per snapshot). */
export async function getMarketFlow(): Promise<{
  tradeDate: string
  sessions: MarketFlowPoint[]
}> {
  const c = await getCache()
  return { tradeDate: c.latestParsed.tradeDate, sessions: c.marketFlow }
}

/** Sector-level foreign-flow rotation for the latest session (prebuilt). */
export async function getSectorRotation(): Promise<{
  tradeDate: string
  sectors: SectorRotationRow[]
}> {
  const c = await getCache()
  return { tradeDate: c.rotationTradeDate, sectors: c.rotation }
}
