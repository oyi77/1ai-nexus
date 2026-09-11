#!/usr/bin/env node
// -------------------------------------------------------------
// Daily alpha track record cron:
//   1. Record today's buy/strong-buy signals
//   2. Evaluate matured signals at 7/14/30 day horizons
//   3. Log stats
//
// Cron: 0 12 * * 1-5 (after harvesters run)
// -------------------------------------------------------------

import "dotenv/config"
import { prisma } from "@/lib/db"
import { recordAlphaSignals, evaluateAlphaTrackRecord, getAlphaTrackStats } from "@/lib/conviction/alpha-track-record"
import { computeAlpha } from "@/lib/conviction/alpha-engine"
import { runAlphaStrongBuyAlerts } from "@/lib/telegram/alpha-alerts"
async function main() {
  const today = new Date().toISOString().slice(0, 10)

  // 1. Compute alpha for all stocks and record buy/strong-buy
  const latestScreener = await prisma.idxScreenerSnapshot.findFirst({
    orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true },
  })
  if (!latestScreener) {
    console.log("[alpha-cron] no screener data, skipping")
    return
  }

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

  // Session data
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
  console.log(`[alpha-cron] recorded ${recorded} buy/strong-buy signals (${today})`)

  // 2. Evaluate matured signals
  const evalResult = await evaluateAlphaTrackRecord()
  console.log(`[alpha-cron] evaluated ${evalResult.evaluated} matured signals`)

  // 3. Log stats
  const stats = await getAlphaTrackStats()
  console.log(`[alpha-cron] track record: ${stats.evaluated} total, ${stats.overallWinRate.toFixed(0)}% win rate, avg 7d: ${stats.avgReturn7d.toFixed(2)}%`)

  // 4. Push strong-buy alerts to opted-in Telegram users
  const alerts = await runAlphaStrongBuyAlerts()
  console.log(`[alpha-cron] alpha alerts: ${alerts.candidates} candidates, ${alerts.alertsSent} sent to ${alerts.usersChecked} users (${alerts.alertsSkipped} skipped)`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("[alpha-cron] failed:", e.message)
  await prisma.$disconnect()
  process.exit(1)
})
