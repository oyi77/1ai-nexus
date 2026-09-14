// ─────────────────────────────────────────────────────────────
// Moonshot Rank — one board across all instruments.
//
// Each leg with live data submits candidates in one uniform shape:
//   { leg, asset, gainPct, horizonHrs, hitRate, confidence, reason }
// Ranking = expected gain per hour × hit-rate.
// Gate: confidence >= 70, board capped at 10.
//
// Leg hit-rates are MEASURED (DB history), never invented:
//   idx      → P(MFE>=20%) of lane='moonshot' rows per verdict
//   crypto   → BacktestResult win-rate per signal source
//   lrfg     → LrfgEvent success rate
//   copy     → leader winRate (per-leader, from the platform)
//   launch   → no history: confidence = hypeScore+20 (capped), labeled
//   predict  → no history: confidence 50 (gated out until proven)
// Fixed gain assumptions (documented, not measured): lrfg 8% snap-back,
// launch 50% bonding→migrate. IDX 20% = the measured event itself.
// ─────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db"
import { getCached } from "@/lib/api/server-cache"
import { computeMoonshot } from "@/lib/conviction/moonshot-engine"
import { getAlphaSignals } from "@/lib/modules/derived/alpha-engine"
import type { AlphaSignal } from "@/lib/modules/derived/alpha/types"
import { fetchLrfgEvents } from "@/lib/modules/derived/lrfg-engine"
import { fetchLaunchAlpha, type LaunchAlphaToken } from "@/lib/modules/derived/launch-alpha-engine"
import { computeSfcConvergence } from "@/lib/modules/derived/sfc-engine"
import { getEnabledPlatforms, getLeaderboardModule } from "@/lib/modules/market/copy-trading/registry"
import type { CopyTradingLeader } from "@/lib/modules/market/copy-trading/types"
import { getCrossPlatformMarkets, getAggregatedMarkets } from "@/lib/modules/prediction/prediction-aggregator"

export const CONFIDENCE_GATE = 70
export const BOARD_LIMIT = 10

export interface MoonshotCandidate {
  leg: string
  asset: string
  direction: string
  gainPct: number
  horizonHrs: number
  hitRate: number
  confidence: number
  reason: string
  expectedHourly?: number
}

export interface LegSummary {
  leg: string
  candidates: number
  passed: number
  hitRate: number | null
}

const VALID_PERIOD_HRS: Record<string, number> = { "4h": 4, "24h": 24, "7d": 168 }

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN
}

// ── Measured hit-rates ──

async function idxLaneStats(): Promise<{ p10: Record<string, number>; p20: Record<string, number>; winRate: number; n: number }> {
  try {
    const rows = await prisma.alphaTrackRecord.findMany({
      where: { lane: "moonshot" },
      select: { verdict: true, outcome30d: true, maxGain30dPct: true },
      take: 10000,
    })
    const byVerdict: Record<string, number[]> = {}
    for (const r of rows) {
      if (r.maxGain30dPct == null) continue
      const arr = byVerdict[r.verdict] ?? []
      arr.push(r.maxGain30dPct)
      byVerdict[r.verdict] = arr
    }
    const p10: Record<string, number> = {}
    const p20: Record<string, number> = {}
    for (const [v, ms] of Object.entries(byVerdict)) {
      p10[v] = ms.length >= 20 ? (ms.filter((m) => m >= 10).length / ms.length) * 100 : 50
      p20[v] = ms.length >= 20 ? (ms.filter((m) => m >= 20).length / ms.length) * 100 : 50
    }
    const scored = rows.filter((r) => r.outcome30d === "win" || r.outcome30d === "loss")
    const winRate =
      scored.length >= 20 ? (scored.filter((r) => r.outcome30d === "win").length / scored.length) * 100 : 50
    return { p10, p20, winRate, n: rows.length }
  } catch {
    return { p10: {}, p20: {}, winRate: 50, n: 0 }
  }
}

async function backtestHitBySource(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const rows = await prisma.$queryRaw<Array<{ source: string; wins: bigint; losses: bigint }>>`
      SELECT source, COUNT(*)FILTER(WHERE outcome='win')as wins, COUNT(*)FILTER(WHERE outcome='loss')as losses
      FROM "BacktestResult" WHERE outcome IN ('win','loss') GROUP BY source
    `
    for (const r of rows) {
      const total = Number(r.wins) + Number(r.losses)
      if (total >= 10) map.set(r.source, (Number(r.wins) / total) * 100)
    }
  } catch {
    /* skip */
  }
  return map
}

async function lrfgHitRate(): Promise<{ hit: number; n: number }> {
  try {
    const rows = await prisma.lrfgEvent.findMany({
      where: { outcome: { not: null } },
      select: { outcome: true },
      take: 500,
    })
    if (rows.length < 10) return { hit: 50, n: rows.length }
    const score = rows.reduce((a, r) => a + (r.outcome === "success" ? 1 : r.outcome === "partial" ? 0.5 : 0), 0)
    return { hit: (score / rows.length) * 100, n: rows.length }
  } catch {
    return { hit: 50, n: 0 }
  }
}

async function gatherIdx(stats: { p10: Record<string, number>; p20: Record<string, number>; winRate: number }): Promise<MoonshotCandidate[]> {
  const out: MoonshotCandidate[] = []
  const latest = await prisma.idxScreenerSnapshot.findFirst({ orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } })
  if (!latest) return out
  const [screenerRows, distinctDates] = await Promise.all([
    prisma.idxScreenerSnapshot.findMany({ where: { snapshotDate: latest.snapshotDate } }),
    prisma.idxSahamSession.findMany({ distinct: ["tradeDate"], orderBy: { tradeDate: "desc" }, select: { tradeDate: true }, take: 30 }),
  ])
  const dates = distinctDates.map((d) => d.tradeDate).sort()
  if (dates.length === 0) return out
  const sessionRows = await prisma.idxSahamSession.findMany({
    where: { tradeDate: { in: dates } },
    select: { code: true, tradeDate: true, close: true, high: true, low: true, volume: true },
  })
  const byCode = new Map<string, typeof sessionRows>()
  for (const r of sessionRows) {
    const arr = byCode.get(r.code) ?? []
    arr.push(r)
    byCode.set(r.code, arr)
  }
  const screenerByCode = new Map(screenerRows.map((s) => [s.code, s]))
  const scored: Array<{ code: string; score: number; verdict: string; reasons: string[] }> = []
  for (const [code, sess] of byCode) {
    if (sess.length < 5) continue
    const scr = screenerByCode.get(code)
    if (!scr) continue
    const sorted = [...sess].sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : 1))
    const last = sorted[sorted.length - 1]
    if (!(last.close > 0)) continue
    const chg = (days: number): number | null => {
      if (sorted.length <= days) return null
      const past = sorted[sorted.length - 1 - days].close
      return past > 0 ? ((last.close - past) / last.close) * 100 : null
    }
    const r = computeMoonshot({
      sessions: sorted.map((s) => ({ date: s.tradeDate, close: s.close, high: s.high, low: s.low, volume: s.volume })),
      screener: {
        change4w: chg(20), change13w: chg(65), change26w: chg(130), change52w: chg(260),
        price: last.close,
        high52w: Math.max(...sorted.map((s) => s.high)),
        marketCap: scr.marketCap,
      },
      sector: scr.sector || "Unknown",
    })
    if (r.verdict === "moonshot" || r.verdict === "watch") {
      scored.push({ code, score: r.totalScore, verdict: r.verdict, reasons: r.topReasons })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  for (const s of scored.slice(0, 30)) {
    const hit = stats.p20[s.verdict] ?? 50
    // Confidence = measured P(+10% in 30d) for this verdict — the moonshot
    // hit definition — not close-to-close win rate.
    const conf = stats.p10[s.verdict] ?? 50
    out.push({
      leg: "idx", asset: s.code, direction: "bullish",
      gainPct: 20, horizonHrs: 720, hitRate: Math.round(hit * 10) / 10,
      confidence: Math.round(conf * 10) / 10,
      reason: s.reasons[0] ?? `Moonshot ${s.score}`,
    })
  }
  return out
}

async function gatherCrypto(hitBySource: Map<string, number>): Promise<MoonshotCandidate[]> {
  const out: MoonshotCandidate[] = []
  const { signals } = await getAlphaSignals()
  const bulls = signals.filter(
    (s: AlphaSignal) =>
      s.direction === "bullish" && s.entry != null && s.entry > 0 && s.tp3 != null && s.tp3 > s.entry && s.sl != null && s.sl > 0 && s.sl < s.entry,
  )
  bulls.sort((a: AlphaSignal, b: AlphaSignal) => b.confidence - a.confidence)
  for (const s of bulls.slice(0, 20)) {
    const gain = ((s.tp3! - s.entry!) / s.entry!) * 100
    if (!(gain > 0) || gain > 200) continue
    const primary = s.sources[0] ?? "unknown"
    // Unproven source (no backtest history) caps confidence — no history,
    // no high-conviction claim. Cap 60 keeps it gated out (< 70).
    const proven = hitBySource.has(primary)
    out.push({
      leg: "crypto", asset: s.symbol, direction: "bullish",
      gainPct: Math.round(gain * 10) / 10,
      horizonHrs: VALID_PERIOD_HRS[s.validPeriod] ?? 24,
      hitRate: hitBySource.get(primary) ?? 50,
      confidence: proven ? Math.round(s.confidence) : Math.min(Math.round(s.confidence), 60),
      reason: s.reasoning?.slice(0, 140) ?? `${primary} signal`,
    })
  }
  return out
}

async function gatherLrfg(hit: number): Promise<MoonshotCandidate[]> {
  const out: MoonshotCandidate[] = []
  const events = await fetchLrfgEvents({ limit: 10 })
  for (const e of events) {
    if (e.reboundedAt) continue
    if (e.type !== "leverage_reset") continue
    out.push({
      leg: "lrfg", asset: `${e.symbol}@${e.exchange}`, direction: "bullish",
      gainPct: 8, horizonHrs: 2, hitRate: Math.round(hit * 10) / 10,
      confidence: Math.round(hit),
      reason: `Leverage reset: OI ${e.oiDeltaPct.toFixed(1)}% | price ${e.priceDeltaPct.toFixed(1)}%`,
    })
  }
  return out
}

async function gatherLaunch(): Promise<MoonshotCandidate[]> {
  const out: MoonshotCandidate[] = []
  const tokens: LaunchAlphaToken[] = await fetchLaunchAlpha({ limit: 10 })
  for (const t of tokens) {
    // Unproven leg (no outcome history): cap confidence at 60 — gated out
    // of the 70-gate board until closeOpportunityLoop proves the setup.
    const conf = Math.min(60, Math.round(t.hypeScore + 20))
    let sfcNote = ""
    try {
      const conv = await computeSfcConvergence(t.symbol)
      if (conv.walletCount > 0 && conv.sfc >= 50) sfcNote = ` SFC ${conv.sfc} (${conv.walletCount} wallets)`
    } catch {
      /* skip */
    }
    out.push({
      leg: "launch", asset: t.symbol, direction: "bullish",
      gainPct: 50, horizonHrs: 72, hitRate: 50,
      confidence: conf,
      reason: `Launch Alpha ${t.launchAlphaScore} (liq $${Math.round(t.liquidityUsd).toLocaleString()})${sfcNote}`,
    })
  }
  return out
}

async function gatherCopy(): Promise<MoonshotCandidate[]> {
  const out: MoonshotCandidate[] = []
  for (const platform of getEnabledPlatforms()) {
    try {
      const mod = getLeaderboardModule(platform)
      if (!mod) continue
      const res = await mod.fetch<{ leaders: CopyTradingLeader[]; total: number }>({
        cycle: "month", order_by: "profit", page_size: 20,
      })
      const leaders = [...(res.data.leaders ?? [])]
        .filter((l) => l.profitRate > 0 && l.aum > 0)
        .sort((a, b) => b.profitRate - a.profitRate)
        .slice(0, 5)
      for (const l of leaders) {
        const wr = num(l.winRate)
        out.push({
          leg: "copy", asset: `${l.nick} (${platform})`, direction: "bullish",
          gainPct: Math.min(200, Math.round(l.profitRate * 10) / 10),
          horizonHrs: 720, hitRate: Number.isFinite(wr) && wr > 0 ? wr : 50,
          confidence: Number.isFinite(wr) && wr > 0 ? Math.round(wr) : 0,
          reason: `Leader ${l.nick}: +${l.profitRate}%/mo, WR ${Number.isFinite(wr) ? wr : "n/a"}%, ${l.followers} followers`,
        })
      }
    } catch {
      /* per-platform isolation */
    }
  }
  return out
}

async function gatherPredict(): Promise<MoonshotCandidate[]> {
  const out: MoonshotCandidate[] = []
  const [cross, agg] = await Promise.all([
    getCrossPlatformMarkets().catch(() => [] as Awaited<ReturnType<typeof getCrossPlatformMarkets>>),
    getAggregatedMarkets({ limit: 100 }).catch(() => null),
  ])
  const endByUrl = new Map<string, string>()
  if (agg) for (const m of agg.markets) if (m.endDate) endByUrl.set(m.url, m.endDate)
  for (const c of cross) {
    if (c.maxSpread < 0.1) continue
    let horizon: number | null = null
    for (const p of c.platforms) {
      const end = endByUrl.get(p.url)
      if (!end) continue
      const hrs = (new Date(end).getTime() - Date.now()) / 3_600_000
      if (hrs > 1 && (horizon == null || hrs < horizon)) horizon = hrs
    }
    if (horizon == null) continue
    out.push({
      leg: "predict", asset: c.question.slice(0, 80), direction: "bullish",
      gainPct: Math.round(c.maxSpread * 1000) / 10,
      horizonHrs: Math.round(horizon),
      hitRate: 50, confidence: 50,
      reason: `Cross-platform spread ${(c.maxSpread * 100).toFixed(1)}pp — unproven leg, gated`,
    })
    if (out.length >= 10) break
  }
  return out
}

// ── Pure ranking (unit-tested) ──

export function rankCandidates(
  candidates: MoonshotCandidate[],
  gate = CONFIDENCE_GATE,
  limit = BOARD_LIMIT,
): MoonshotCandidate[] {
  return candidates
    .filter((c) => c.confidence >= gate && c.gainPct > 0 && c.horizonHrs > 0)
    .map((c) => ({ ...c, expectedHourly: ((c.gainPct * c.hitRate) / 100) / c.horizonHrs }))
    .sort((a, b) => (b.expectedHourly ?? 0) - (a.expectedHourly ?? 0))
    .slice(0, limit)
}

export interface MoonshotBoard {
  updatedAt: string
  gate: number
  limit: number
  board: MoonshotCandidate[]
  legs: LegSummary[]
  proof: { idxN: number; backtestSources: number; lrfgN: number }
}

async function computeBoard(): Promise<MoonshotBoard> {
  const [idxStats, hitBySource, lrfg] = await Promise.all([idxLaneStats(), backtestHitBySource(), lrfgHitRate()])
  const settled = await Promise.allSettled([
    gatherIdx(idxStats),
    gatherCrypto(hitBySource),
    gatherLrfg(lrfg.hit),
    gatherLaunch(),
    gatherCopy(),
    gatherPredict(),
  ])
  const [idx, crypto, lrg, launch, copy, predict] = settled.map((r) => (r.status === "fulfilled" ? r.value : []))
  const legs: LegSummary[] = [
    { leg: "idx", candidates: idx.length, passed: 0, hitRate: idxStats.n >= 20 ? idxStats.winRate : null },
    { leg: "crypto", candidates: crypto.length, passed: 0, hitRate: null },
    { leg: "lrfg", candidates: lrg.length, passed: 0, hitRate: lrfg.n >= 10 ? lrfg.hit : null },
    { leg: "launch", candidates: launch.length, passed: 0, hitRate: null },
    { leg: "copy", candidates: copy.length, passed: 0, hitRate: null },
    { leg: "predict", candidates: predict.length, passed: 0, hitRate: null },
  ]
  const all = [...idx, ...crypto, ...lrg, ...launch, ...copy, ...predict]
  const board = rankCandidates(all)
  for (const l of legs) l.passed = board.filter((c) => c.leg === l.leg).length
  return {
    updatedAt: new Date().toISOString(),
    gate: CONFIDENCE_GATE,
    limit: BOARD_LIMIT,
    board,
    legs,
    proof: { idxN: idxStats.n, backtestSources: hitBySource.size, lrfgN: lrfg.n },
  }
}

/** Cached board (5 min) — gather fans out to live modules per recompute. */
export async function getMoonshotBoard(): Promise<MoonshotBoard> {
  const { data } = await getCached<MoonshotBoard>("moonshot:board", 300_000, computeBoard)
  return data
}
