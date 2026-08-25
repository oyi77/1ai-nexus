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
// SERVER-ONLY (node:fs). Consume via /api/v1/saham/bandarmology.
// ─────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises'
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
  estNetValueIdr: number // netVol × close (approximation — volumes, not lots)
}

export interface ForeignStreak extends ForeignLeader {
  days: number
  direction: 'accumulation' | 'distribution'
}

const LatestSchema = z.object({
  capturedAt: z.string(),
  tradeDate: z.string(),
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
  historySessions: number
}

async function readLatest(): Promise<{ parsed: z.infer<typeof LatestSchema>; meta: SahamMeta }> {
  const parsed = LatestSchema.parse(JSON.parse(await readFile(join(DIR, 'saham-latest.json'), 'utf8')))
  return {
    parsed,
    meta: { tradeDate: parsed.tradeDate, capturedAt: parsed.capturedAt, count: parsed.rows.length, historySessions: 0 },
  }
}

async function readHistory(): Promise<z.infer<typeof HistorySchema>> {
  return HistorySchema.parse(JSON.parse(await readFile(join(DIR, 'foreign-history.json'), 'utf8')))
}

async function readBrokers(): Promise<z.infer<typeof BrokersSchema>> {
  return BrokersSchema.parse(JSON.parse(await readFile(join(DIR, 'brokers-latest.json'), 'utf8')))
}

function toLeader(r: z.infer<typeof LatestSchema>['rows'][number]): ForeignLeader {
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

/** Top foreign net-buy / net-sell stocks for the latest session. */
export async function getForeignLeaders(limit = 20): Promise<{
  meta: SahamMeta
  topBuy: ForeignLeader[]
  topSell: ForeignLeader[]
}> {
  const { parsed, meta } = await readLatest()
  let historySessions = 0
  try {
    historySessions = (await readHistory()).sessions.length
  } catch { /* optional */ }
  const leaders = parsed.rows.filter((r) => r.foreignBuy > 0 || r.foreignSell > 0).map(toLeader)
  const byValue = [...leaders].sort((a, b) => b.estNetValueIdr - a.estNetValueIdr)
  return {
    meta: { ...meta, historySessions },
    topBuy: byValue.slice(0, limit),
    topSell: [...byValue].reverse().slice(0, limit),
  }
}

/** Consecutive-session foreign accumulation/distribution streaks. */
export async function getForeignStreaks(minDays = 3, limit = 25): Promise<{
  meta: SahamMeta & { sessionsUsed: number }
  accumulation: ForeignStreak[]
  distribution: ForeignStreak[]
}> {
  const [latest, history] = await Promise.all([readLatest(), readHistory()])
  const sessions = history.sessions.slice(-30)
  const streakOf = (code: string): { days: number; dir: 'accumulation' | 'distribution' | null } => {
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
    return { days, dir }
  }

  const leaders = latest.parsed.rows.map(toLeader)
  const withStreaks: ForeignStreak[] = []
  for (const l of leaders) {
    const st = streakOf(l.code)
    if (st.dir && st.days >= minDays) withStreaks.push({ ...l, days: st.days, direction: st.dir })
  }
  const acc = withStreaks.filter((s) => s.direction === 'accumulation').sort((a, b) => b.days - a.days || b.estNetValueIdr - a.estNetValueIdr).slice(0, limit)
  const dist = withStreaks.filter((s) => s.direction === 'distribution').sort((a, b) => b.days - a.days || a.estNetValueIdr - b.estNetValueIdr).slice(0, limit)
  return {
    meta: { tradeDate: latest.meta.tradeDate, capturedAt: latest.meta.capturedAt, count: latest.meta.count, historySessions: history.sessions.length, sessionsUsed: sessions.length },
    accumulation: acc,
    distribution: dist,
  }
}

/** Per-symbol daily foreign-net series (oldest→newest). */
export async function getForeignSeries(symbol: string, days = 30): Promise<{
  symbol: string
  series: Array<{ date: string; fbuy: number; fsell: number; net: number; close: number }>
} | null> {
  const history = await readHistory()
  const code = symbol.replace('.JK', '').toUpperCase()
  const series = history.sessions
    .slice(-days)
    .map((s) => {
      const e = s.stocks[code]
      return e ? { date: s.date, fbuy: e.fbuy, fsell: e.fsell, net: e.fbuy - e.fsell, close: e.close } : null
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
  const parsed = await readBrokers()
  return {
    tradeDate: parsed.tradeDate,
    rows: [...parsed.rows].sort((a, b) => b.value - a.value).slice(0, limit),
  }
}
