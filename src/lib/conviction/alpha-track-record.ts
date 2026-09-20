// ─────────────────────────────────────────────────────────────
// Alpha Track Record — prove the engines work.
//
// Daily cron:
//   1. Record today's signals (idempotent per code+date+lane).
//      lane='alpha': buy/strong-buy. lane='moonshot': moonshot/watch.
//   2. Evaluate matured signals at 7/14/30/60d + MFE from session highs.
//   3. Compute stats: hit rate, avg return, tail (P10/P20/P30), by verdict
//      + sector + lane.
// ─────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"

const HORIZONS = [7, 14, 30, 60] as const
const WIN_THRESHOLD = 0.5 // +0.5% counts as a win
const TAIL_LEVELS = [10, 20, 30] as const
const FWD_30 = 21 // ~30 calendar days in trading sessions
const FWD_60 = 42 // ~60 calendar days

export interface TrackSignal {
  code: string
  sector: string
  alphaScore: number
  verdict: string
  price: number
  reasons: string[]
  lane?: string
}

/** Record today's signals. Idempotent per code+date+lane. */
export async function recordAlphaSignals(signals: TrackSignal[]): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  let recorded = 0

  for (const s of signals) {
    const lane = s.lane ?? "alpha"
    const ok =
      lane === "moonshot"
        ? s.verdict === "moonshot" || s.verdict === "watch"
        : s.verdict === "buy" || s.verdict === "strong-buy"
    if (!ok) continue
    if (!s.price || s.price <= 0) continue

    try {
      await prisma.alphaTrackRecord.upsert({
        where: { code_signalDate_lane: { code: s.code, signalDate: today, lane } },
        create: {
          code: s.code,
          sector: s.sector,
          signalDate: today,
          lane,
          alphaScore: s.alphaScore,
          verdict: s.verdict,
          priceAtSignal: s.price,
          signals: s.reasons as unknown as object,
        },
        update: {}, // keep first signal of the day
      })
      recorded++
    } catch (err) {
      console.error(`[alpha-track] record failed for ${s.code}:`, (err as Error).message)
    }
  }

  return recorded
}

/** Max high over the N sessions after signalDate (exclusive). Null if <10. */
async function maxForwardHigh(code: string, signalDate: string, n: number): Promise<number | null> {
  try {
    const rows = await prisma.idxSahamSession.findMany({
      where: { code, tradeDate: { gt: signalDate } },
      orderBy: { tradeDate: "asc" },
      take: n,
      select: { high: true },
    })
    if (rows.length < 10) return null
    let mh = -Infinity
    for (const r of rows) if (r.high > mh) mh = r.high
    return mh > 0 ? mh : null
  } catch {
    return null
  }
}

/** Forward close at the exact horizon: close of the Nth trading session after
 * the signal date (N = sessions, NOT calendar days). Returns null when the
 * horizon has not matured — the caller must SKIP, never score. */
async function forwardCloseAtHorizon(code: string, signalDate: string, sessions: number): Promise<number | null> {
  try {
    const rows = await prisma.idxSahamSession.findMany({
      where: { code, tradeDate: { gt: signalDate } },
      orderBy: { tradeDate: "asc" },
      take: sessions,
      select: { close: true },
    })
    if (rows.length < sessions) return null
    const c = rows[rows.length - 1].close
    return c > 0 ? c : null
  } catch {
    return null
  }
}

// Horizons in trading sessions (avg 21 sessions ≈ 30 calendar days).
const HORIZON_SESSIONS: Record<number, number> = { 7: 5, 14: 10, 30: 21, 60: 42 }

/** Evaluate matured signals at all horizons + MFE tails.
 * Every horizon price is the close at that exact session offset — never the
 * latest snapshot. A horizon fills only when its forward sessions exist. */
export async function evaluateAlphaTrackRecord(): Promise<{
  evaluated: number
  horizons: Record<string, { evaluated: number; wins: number; avgPnl: number }>
}> {
  const horizons: Record<string, { evaluated: number; wins: number; avgPnl: number }> = {}
  let totalEvaluated = 0

  for (const days of HORIZONS) {
    const field = `price${days}d` as const
    const pnlField = `pnl${days}dPct` as const
    const outcomeField = `outcome${days}d` as const
    const sessions = HORIZON_SESSIONS[days] ?? days

    // Only rows old enough to have the full forward window can be scored.
    // (No calendar cutoff: a row without its forward sessions simply waits.)
    const pending = await prisma.alphaTrackRecord.findMany({
      where: { [field]: null, priceAtSignal: { gt: 0 } } as Prisma.AlphaTrackRecordWhereInput,
      take: 200,
      orderBy: { signalDate: "asc" },
    })

    let wins = 0
    let pnlSum = 0
    let evaluated = 0

    for (const s of pending) {
      const current = await forwardCloseAtHorizon(s.code, s.signalDate, sessions)
      if (current == null) continue // horizon not matured — wait, never score

      const priceAt = s.priceAtSignal!
      const pnlPct = priceAt > 0 ? ((current - priceAt) / priceAt) * 100 : 0
      const isWin = pnlPct > WIN_THRESHOLD

      const updateData: Record<string, unknown> = { evaluatedAt: new Date() }
      updateData[field] = current
      updateData[pnlField] = pnlPct
      updateData[outcomeField] = isWin ? "win" : "loss"

      // MFE tails (30d → 21 sessions, 60d → 42 sessions)
      if (days === 30 && s.maxGain30dPct == null) {
        const mh = await maxForwardHigh(s.code, s.signalDate, FWD_30)
        if (mh != null && priceAt > 0) updateData["maxGain30dPct"] = ((mh - priceAt) / priceAt) * 100
      }
      if (days === 60 && s.maxGain60dPct == null) {
        const mh = await maxForwardHigh(s.code, s.signalDate, FWD_60)
        if (mh != null && priceAt > 0) updateData["maxGain60dPct"] = ((mh - priceAt) / priceAt) * 100
      }

      await prisma.alphaTrackRecord.update({
        where: { id: s.id },
        data: updateData as Prisma.AlphaTrackRecordUpdateInput,
      })

      evaluated++
      pnlSum += pnlPct
      if (isWin) wins++
    }

    horizons[`${days}d`] = { evaluated, wins, avgPnl: evaluated > 0 ? pnlSum / evaluated : 0 }
    totalEvaluated += evaluated
  }

  return { evaluated: totalEvaluated, horizons }
}

function tailRates(rows: Array<{ maxGain30dPct: number | null }>): Record<string, number> {
  const ms = rows.map((r) => r.maxGain30dPct).filter((v): v is number => v != null)
  const out: Record<string, number> = {}
  for (const t of TAIL_LEVELS) {
    out[`p${t}`] = ms.length > 0 ? (ms.filter((v) => v >= t).length / ms.length) * 100 : 0
  }
  out.avgMfe = ms.length > 0 ? ms.reduce((a, b) => a + b, 0) / ms.length : 0
  out.n = ms.length
  return out
}

/** Compute aggregate stats: hit rate, avg return, tail, by verdict + sector + lane. */
export async function getAlphaTrackStats(lane?: string): Promise<{
  total: number
  evaluated: number
  overallWinRate: number
  avgReturn7d: number
  avgReturn14d: number
  avgReturn30d: number
  avgReturn60d: number
  tail: Record<string, number>
  byVerdict: Array<{ verdict: string; count: number; winRate: number; avgReturn: number; tail: Record<string, number> }>
  bySector: Array<{ sector: string; count: number; winRate: number; avgReturn: number }>
  byLane: Array<{ lane: string; count: number; winRate: number; tail: Record<string, number> }>
  recent: Array<{ code: string; signalDate: string; verdict: string; alphaScore: number; pnl7d: number | null; pnl14d: number | null; pnl30d: number | null; maxGain30d: number | null }>
}> {
  const laneFilter = lane ? { lane } : {}
  const all = await prisma.alphaTrackRecord.findMany({
    where: { ...laneFilter, outcome7d: { not: null } },
  })

  // Most recent evaluated signals for the "recent" panel.
  const recentRows = await prisma.alphaTrackRecord.findMany({
    where: { ...laneFilter, outcome7d: { not: null } },
    orderBy: { signalDate: "desc" },
    take: 20,
  })

  const evaluated = all.length
  const wins = all.filter((s) => s.outcome7d === "win").length
  const overallWinRate = evaluated > 0 ? (wins / evaluated) * 100 : 0

  const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const pnl = (f: "pnl7dPct" | "pnl14dPct" | "pnl30dPct" | "pnl60dPct") =>
    all.filter((s) => s[f] != null).map((s) => s[f]!)

  // By verdict (with tail per verdict)
  const verdictGroups = new Map<string, typeof all>()
  for (const s of all) {
    const arr = verdictGroups.get(s.verdict) ?? []
    arr.push(s)
    verdictGroups.set(s.verdict, arr)
  }
  const byVerdict = [...verdictGroups.entries()].map(([verdict, rows]) => {
    const w = rows.filter((r) => r.outcome7d === "win").length
    const r7 = rows.filter((r) => r.pnl7dPct != null).map((r) => r.pnl7dPct!)
    return {
      verdict,
      count: rows.length,
      winRate: rows.length > 0 ? (w / rows.length) * 100 : 0,
      avgReturn: avg(r7),
      tail: tailRates(rows),
    }
  })

  // By sector
  const sectorGroups = new Map<string, typeof all>()
  for (const s of all) {
    const arr = sectorGroups.get(s.sector) ?? []
    arr.push(s)
    sectorGroups.set(s.sector, arr)
  }
  const bySector = [...sectorGroups.entries()]
    .map(([sector, rows]) => {
      const w = rows.filter((r) => r.outcome7d === "win").length
      const r7 = rows.filter((r) => r.pnl7dPct != null).map((r) => r.pnl7dPct!)
      return {
        sector,
        count: rows.length,
        winRate: rows.length > 0 ? (w / rows.length) * 100 : 0,
        avgReturn: avg(r7),
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // By lane (alpha vs moonshot tail comparison)
  const laneGroups = new Map<string, typeof all>()
  for (const s of all) {
    const arr = laneGroups.get(s.lane) ?? []
    arr.push(s)
    laneGroups.set(s.lane, arr)
  }
  const byLane = [...laneGroups.entries()].map(([l, rows]) => {
    const w = rows.filter((r) => r.outcome7d === "win").length
    return {
      lane: l,
      count: rows.length,
      winRate: rows.length > 0 ? (w / rows.length) * 100 : 0,
      tail: tailRates(rows),
    }
  })

  const recent = recentRows.map((s) => ({
    code: s.code,
    signalDate: s.signalDate,
    verdict: s.verdict,
    alphaScore: s.alphaScore,
    pnl7d: s.pnl7dPct,
    pnl14d: s.pnl14dPct,
    pnl30d: s.pnl30dPct,
    maxGain30d: s.maxGain30dPct,
  }))

  return {
    total: await prisma.alphaTrackRecord.count({ where: laneFilter }),
    evaluated,
    overallWinRate,
    avgReturn7d: avg(pnl("pnl7dPct")),
    avgReturn14d: avg(pnl("pnl14dPct")),
    avgReturn30d: avg(pnl("pnl30dPct")),
    avgReturn60d: avg(pnl("pnl60dPct")),
    tail: tailRates(all),
    byVerdict,
    bySector,
    byLane,
    recent,
  }
}
