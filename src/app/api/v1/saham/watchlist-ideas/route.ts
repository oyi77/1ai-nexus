// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/watchlist-ideas — value + accumulation + alpha
// scoring for IDX moon baggers.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { computeAlpha, type AlphaInput } from "@/lib/conviction/alpha-engine"
import type { IdxScreenerSnapshot, Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

type SessionSlice = AlphaInput["sessions"][number]
type FundamentalsSlice = Prisma.IdxFundamentalsGetPayload<{ select: { code: true; dividendYield: true } }>

interface StreakInfo {
  days: number
  dir: "accumulation" | "distribution" | null
  latestNetVol: number
  latestClose: number
  estNetValue: number
  sessions: SessionSlice[]
}

interface Idea {
  code: string; name: string; sector: string; close: number; changePct: number
  per: number | null; pbv: number | null; roe: number | null; der: number | null
  dividendYield: number | null; marketCap: number | null
  foreignNetStreakDays: number; foreignNetStreakDir: "accumulation" | "distribution" | null
  estNetValueIdr: number; valueScore: number; accumulationScore: number; combinedScore: number
  alphaScore: number; alphaVerdict: string; alphaReasons: string[]
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN
}
function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length
}
function stdDev(arr: number[]): number {
  if (arr.length < 2) return 1
  const m = mean(arr)
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2))) || 1
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const minScore = Math.max(0, Number(p.get("minScore") ?? 1))
  const limit = Math.min(Math.max(1, Number(p.get("limit") ?? 50)), 200)
  const valueWeight = Math.min(1, Math.max(0, Number(p.get("valueWeight") ?? 0.5)))
  const accumWeight = 1 - valueWeight
  const includeAlpha = p.get("alpha") !== "0"

  try {
    // Load screener + fundamentals
    const latestScreener = await prisma.idxScreenerSnapshot.findFirst({ orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } })
    const screenerByCode = new Map<string, IdxScreenerSnapshot>()
    if (latestScreener) {
      const rows = await prisma.idxScreenerSnapshot.findMany({ where: { snapshotDate: latestScreener.snapshotDate } })
      for (const r of rows) screenerByCode.set(r.code, r)
    }

    const latestFund = await prisma.idxFundamentals.findFirst({ orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } })
    const fundByCode = new Map<string, FundamentalsSlice>()
    if (latestFund) {
      const rows = await prisma.idxFundamentals.findMany({ where: { snapshotDate: latestFund.snapshotDate }, select: { code: true, dividendYield: true } })
      for (const r of rows) fundByCode.set(r.code, r)
    }

    if (screenerByCode.size === 0) return apiSuccess({ tradeDate: "", screenerDate: "", count: 0, ideas: [] })

    // Universe stats (winsorized)
    const pers: number[] = [], roes: number[] = [], pbvs: number[] = []
    for (const [, s] of screenerByCode) {
      const per = num(s.per); if (!Number.isNaN(per) && per > 0 && per <= 100) pers.push(per)
      const roe = num(s.roe); if (!Number.isNaN(roe) && roe >= -50 && roe <= 100) roes.push(roe)
      const pbv = num(s.pbv); if (!Number.isNaN(pbv) && pbv > 0 && pbv <= 20) pbvs.push(pbv)
    }
    const universeStats = { perMean: mean(pers), perStd: stdDev(pers), roeMean: mean(roes), roeStd: stdDev(roes), pbvMean: mean(pbvs), pbvStd: stdDev(pbvs) }

    // BULK: last 30 sessions
    const distinctDates = await prisma.idxSahamSession.findMany({ distinct: ["tradeDate"], orderBy: { tradeDate: "desc" }, select: { tradeDate: true }, take: 30 })
    const dates = distinctDates.map((d) => d.tradeDate).sort()
    const streakMap = new Map<string, StreakInfo>()

    if (dates.length > 0) {
      const rows = await prisma.idxSahamSession.findMany({
        where: { tradeDate: { in: dates } },
        select: { code: true, tradeDate: true, foreignBuy: true, foreignSell: true, close: true, volume: true, value: true, high: true, low: true, open: true },
      })
      const byCode = new Map<string, SessionSlice[]>()
      for (const r of rows) {
        const arr = byCode.get(r.code) ?? []
        arr.push({ date: r.tradeDate, close: r.close, volume: r.volume, value: r.value, foreignBuy: r.foreignBuy, foreignSell: r.foreignSell, high: r.high, low: r.low, open: r.open })
        byCode.set(r.code, arr)
      }
      for (const [code, sRows] of byCode) {
        let days = 0, dir: "accumulation" | "distribution" | null = null
        for (let i = sRows.length - 1; i >= 0; i--) {
          const net = sRows[i].foreignBuy - sRows[i].foreignSell
          if (net === 0) break
          const cur = net > 0 ? "accumulation" : "distribution"
          if (dir === null) dir = cur; else if (cur !== dir) break
          days++
        }
        const latest = sRows[sRows.length - 1]
        const netVol = latest ? latest.foreignBuy - latest.foreignSell : 0
        streakMap.set(code, { days, dir, latestNetVol: netVol, latestClose: latest?.close ?? 0, estNetValue: netVol * (latest?.close ?? 0), sessions: sRows })
      }
    }

    const latestSessionDate = dates[dates.length - 1]
    const brokers = latestSessionDate
      ? await prisma.idxBrokerBoard.findMany({ where: { tradeDate: latestSessionDate }, select: { firm: true, value: true, volume: true } })
      : []

    const ideas: Idea[] = []
    for (const [code, fund] of screenerByCode) {
      const dyInfo = fundByCode.get(code)
      const per = num(fund.per), pbv = num(fund.pbv), roe = num(fund.roe), der = num(fund.der), dy = num(dyInfo?.dividendYield)
      const sector = fund.sector || "Unknown"

      const perMedian = mean([...screenerByCode.values()].filter((s) => s.sector === sector).map((s) => num(s.per)).filter((v: number) => !Number.isNaN(v) && v > 0)) || 1
      let valueScore = 0
      if (!Number.isNaN(per) && per > 0 && per < perMedian) valueScore++
      if (!Number.isNaN(pbv) && pbv > 0 && pbv < 1) valueScore++
      if (!Number.isNaN(roe) && roe > 15) valueScore++
      if (!Number.isNaN(der) && der > 0 && der < 1) valueScore++
      if (!Number.isNaN(dy) && dy > 3) valueScore++

      const streak = streakMap.get(code)
      const accumulationScore = streak?.dir === "accumulation" ? Math.min(streak.days, 5) : 0
      const combinedScore = valueScore * valueWeight + accumulationScore * accumWeight

      let alphaScore = 0, alphaVerdict = "hold", alphaReasons: string[] = []
      if (includeAlpha && streak?.sessions?.length) {
        const result = computeAlpha({
          sessions: streak.sessions,
          brokers: brokers.map((b) => ({ firm: b.firm, value: b.value, volume: b.volume })),
          screener: { per: fund.per, pbv: fund.pbv, roe: fund.roe, der: fund.der, change1d: fund.change1d, change4w: fund.change4w, change13w: fund.change13w, change26w: fund.change26w, change52w: fund.change52w, marketCap: fund.marketCap, price: fund.price, high52w: fund.high52w, low52w: fund.low52w },
          universeStats,
        })
        alphaScore = result.totalScore; alphaVerdict = result.verdict; alphaReasons = result.topReasons
      }

      if (combinedScore >= minScore) {
        ideas.push({
          code, name: fund.name, sector, close: fund.price ?? 0, changePct: fund.change1d ?? 0,
          per: fund.per, pbv: fund.pbv, roe: fund.roe, der: fund.der,
          dividendYield: dyInfo?.dividendYield ?? null, marketCap: fund.marketCap,
          foreignNetStreakDays: streak?.days ?? 0, foreignNetStreakDir: streak?.dir ?? null,
          estNetValueIdr: streak?.estNetValue ?? 0, valueScore, accumulationScore, combinedScore,
          alphaScore, alphaVerdict, alphaReasons,
        })
      }
    }

    ideas.sort((a, b) => b.alphaScore - a.alphaScore || b.combinedScore - a.combinedScore)
    const resp = apiSuccess({ tradeDate: latestScreener?.snapshotDate ?? "", screenerDate: latestScreener?.snapshotDate ?? "", fundamentalsDate: latestFund?.snapshotDate ?? "", sessionDates: dates.length, count: ideas.length, ideas: ideas.slice(0, limit) })
    resp.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    return resp
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
