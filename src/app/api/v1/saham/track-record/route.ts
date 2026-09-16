// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/track-record — alpha + moonshot accuracy stats.
//   ?action=record   record today's signals (both lanes)
//   ?action=evaluate evaluate matured signals at 7/14/30/60d + MFE tails
//   ?lane=alpha|moonshot  filter stats by lane (default: all)
//   (default)        return aggregate stats
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { recordAlphaSignals, evaluateAlphaTrackRecord, getAlphaTrackStats } from "@/lib/conviction/alpha-track-record"
import { computeAlpha } from "@/lib/conviction/alpha-engine"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action")

  try {
    if (action === "record") {
      // Recompute today's alpha and record buy/strong-buy signals
      const latestScreener = await prisma.idxScreenerSnapshot.findFirst({
        orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true },
      })
      if (!latestScreener) return apiError("No screener data", 404)

      const screenerRows = await prisma.idxScreenerSnapshot.findMany({
        where: { snapshotDate: latestScreener.snapshotDate },
      })

      // Universe stats
      const pers: number[] = [], roes: number[] = [], pbvs: number[] = []
      for (const r of screenerRows) {
        if (r.per != null && r.per > 0 && r.per <= 100) pers.push(r.per)
        if (r.roe != null && r.roe >= -50 && r.roe <= 100) roes.push(r.roe)
        if (r.pbv != null && r.pbv > 0 && r.pbv <= 20) pbvs.push(r.pbv)
      }
      const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
      const std = (a: number[]) => a.length < 2 ? 1 : Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2))) || 1
      const universeStats = { perMean: mean(pers), perStd: std(pers), roeMean: mean(roes), roeStd: std(roes), pbvMean: mean(pbvs), pbvStd: std(pbvs) }

      // Get session data for alpha
      const distinctDates = await prisma.idxSahamSession.findMany({
        distinct: ["tradeDate"], orderBy: { tradeDate: "desc" }, select: { tradeDate: true }, take: 30,
      })
      const dates = distinctDates.map((d) => d.tradeDate).sort()
      const sessionRows = dates.length
        ? await prisma.idxSahamSession.findMany({
            where: { tradeDate: { in: dates } },
            select: { code: true, tradeDate: true, foreignBuy: true, foreignSell: true, close: true, volume: true, value: true, high: true, low: true, open: true },
          })
        : []
      const sessionsByCode = new Map<string, typeof sessionRows>()
      for (const r of sessionRows) {
        const arr = sessionsByCode.get(r.code) ?? []
        arr.push(r)
        sessionsByCode.set(r.code, arr)
      }

      const latestSessionDate = dates[dates.length - 1]
      const brokers = latestSessionDate
        ? await prisma.idxBrokerBoard.findMany({ where: { tradeDate: latestSessionDate }, select: { firm: true, value: true, volume: true } })
        : []

      const signals: Array<{ code: string; sector: string; alphaScore: number; verdict: string; price: number; reasons: string[] }> = []
      for (const r of screenerRows) {
        const sess = sessionsByCode.get(r.code) ?? []
        if (!sess.length || !r.price) continue
        const result = computeAlpha({
          sessions: sess.map((s) => ({ date: s.tradeDate, close: s.close, volume: s.volume, value: s.value, foreignBuy: s.foreignBuy, foreignSell: s.foreignSell, high: s.high, low: s.low, open: s.open })),
          brokers: brokers.map((b) => ({ firm: b.firm, value: b.value, volume: b.volume })),
          screener: { per: r.per, pbv: r.pbv, roe: r.roe, der: r.der, change1d: r.change1d, change4w: r.change4w, change13w: r.change13w, change26w: r.change26w, change52w: r.change52w, marketCap: r.marketCap, price: r.price, high52w: r.high52w, low52w: r.low52w },
          universeStats,
        })
        signals.push({ code: r.code, sector: r.sector, alphaScore: result.totalScore, verdict: result.verdict, price: r.price, reasons: result.topReasons })
      }

      const recorded = await recordAlphaSignals(signals)
      return apiSuccess({ recorded, total: signals.length, date: new Date().toISOString().slice(0, 10) })
    }

    if (action === "evaluate") {
      const result = await evaluateAlphaTrackRecord()
      return apiSuccess(result)
    }

    // Default: return stats (optional ?lane= filter: alpha|moonshot|rs|breakout|ara)
    const laneParam = request.nextUrl.searchParams.get("lane")
    const lanes = ["alpha", "moonshot", "rs", "breakout", "ara"] as const
    const stats = await getAlphaTrackStats(
      (lanes as readonly string[]).includes(laneParam ?? "") ? (laneParam as (typeof lanes)[number]) : undefined,
    )
    return apiSuccess(stats)
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
