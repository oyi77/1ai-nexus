// ─────────────────────────────────────────────────────────────
// Moonshot Backfill — point-in-time replay for the moonshot lane.
//
// For each historical session date D (with >= 5 prior sessions):
//   1. Compute computeMoonshot using ONLY sessions up to D.
//      Momentum fields derived from session closes (no lookahead).
//      marketCap/high52w/sector from LATEST screener (slow-drift caveat,
//      same as alpha-track-backfill).
//   2. Record moonshot/watch verdicts with lane='moonshot'.
//   3. Evaluate close-to-close PnL at 7/14/30/60d + MFE (session highs)
//      over forward 21/42 sessions.
//
// Run: npx tsx src/scripts/moonshot-backfill.ts
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { computeMoonshot } from '@/lib/conviction/moonshot-engine'

const WIN_THRESHOLD = 0.5
const FWD_30 = 21
const FWD_60 = 42

type SessionRow = {
  code: string; tradeDate: string
  open: number; high: number; low: number; close: number
  volume: number; value: number; foreignBuy: number; foreignSell: number
}

async function main() {
  const allSessions = await prisma.idxSahamSession.findMany({
    orderBy: [{ code: 'asc' }, { tradeDate: 'asc' }],
  })
  const byCode = new Map<string, SessionRow[]>()
  for (const r of allSessions) {
    const arr = byCode.get(r.code) ?? []
    arr.push(r)
    byCode.set(r.code, arr)
  }
  const allDates = [...new Set(allSessions.map((r) => r.tradeDate))].sort()
  console.log(`[moonshot-backfill] ${allSessions.length} sessions, ${allDates.length} dates (${allDates[0]} → ${allDates[allDates.length - 1]})`)

  const latestScreenerDate = await prisma.idxScreenerSnapshot.findFirst({ orderBy: { snapshotDate: 'desc' }, select: { snapshotDate: true } })
  if (!latestScreenerDate) { console.log('no screener data'); return }
  const screenerRows = await prisma.idxScreenerSnapshot.findMany({ where: { snapshotDate: latestScreenerDate.snapshotDate } })
  const screenerByCode = new Map(screenerRows.map((s) => [s.code, s]))

  const dateIdx = new Map(allDates.map((d, i) => [d, i]))
  function futureClose(code: string, fromDate: string, horizonDays: number): number | null {
    const idx = dateIdx.get(fromDate)
    if (idx === undefined) return null
    const target = new Date(fromDate + 'T00:00:00Z')
    target.setUTCDate(target.getUTCDate() + horizonDays)
    const targetStr = target.toISOString().slice(0, 10)
    for (let i = idx + 1; i < allDates.length; i++) {
      if (allDates[i] >= targetStr) {
        const s = byCode.get(code)?.find((r) => r.tradeDate === allDates[i])
        return s && s.close > 0 ? s.close : null
      }
    }
    return null
  }
  function forwardWindow(code: string, fromDate: string, n: number): SessionRow[] {
    const arr = byCode.get(code) ?? []
    const idx = arr.findIndex((r) => r.tradeDate === fromDate)
    if (idx < 0) return []
    return arr.slice(idx + 1, idx + 1 + n)
  }

  const START_IDX = 25
  const MIN_PRIOR = 5
  let recorded = 0, evaluated = 0

  for (let di = START_IDX; di < allDates.length; di++) {
    const date = allDates[di]
    const signals: Array<{
      code: string; sector: string; score: number; verdict: string
      price: number; reasons: string[]; signalsJson: unknown
    }> = []

    for (const [code, sessions] of byCode) {
      const upto = sessions.filter((s) => s.tradeDate <= date)
      if (upto.length < MIN_PRIOR) continue
      const last = upto[upto.length - 1]
      if (last.tradeDate !== date) continue
      const scr = screenerByCode.get(code)
      if (!scr) continue

      const close = last.close
      if (!(close > 0)) continue
      const chg = (days: number): number | null => {
        if (upto.length <= days) return null
        const past = upto[upto.length - 1 - days].close
        return past > 0 ? ((close - past) / past) * 100 : null
      }
      const result = computeMoonshot({
        sessions: upto.map((s) => ({ date: s.tradeDate, close: s.close, high: s.high, low: s.low, volume: s.volume })),
        screener: {
          change4w: chg(20), change13w: chg(65), change26w: chg(130), change52w: chg(260),
          price: close,
          high52w: Math.max(...upto.map((s) => s.high)),
          marketCap: scr.marketCap,
        },
        sector: scr.sector || 'Unknown',
      })
      if (result.verdict === 'moonshot' || result.verdict === 'watch') {
        signals.push({
          code, sector: scr.sector || 'Unknown', score: result.totalScore,
          verdict: result.verdict, price: close,
          reasons: result.topReasons, signalsJson: result.components,
        })
      }
    }

    for (const s of signals) {
      const p7 = futureClose(s.code, date, 7)
      const p14 = futureClose(s.code, date, 14)
      const p30 = futureClose(s.code, date, 30)
      const p60 = futureClose(s.code, date, 60)
      const pnl = (p: number | null) => (p !== null && s.price > 0 ? (p / s.price - 1) * 100 : null)
      const pnl7 = pnl(p7), pnl14 = pnl(p14), pnl30 = pnl(p30), pnl60 = pnl(p60)
      const out = (p: number | null) => (p === null ? null : p >= WIN_THRESHOLD ? 'win' : 'loss')

      const w30 = forwardWindow(s.code, date, FWD_30)
      const w60 = forwardWindow(s.code, date, FWD_60)
      const mfe30 = w30.length >= 10 ? (Math.max(...w30.map((r) => r.high)) / s.price - 1) * 100 : null
      const mfe60 = w60.length >= 10 ? (Math.max(...w60.map((r) => r.high)) / s.price - 1) * 100 : null

      await prisma.alphaTrackRecord.upsert({
        where: { code_signalDate_lane: { code: s.code, signalDate: date, lane: 'moonshot' } },
        create: {
          code: s.code, sector: s.sector, signalDate: date, lane: 'moonshot',
          alphaScore: Math.round(s.score), verdict: s.verdict, priceAtSignal: s.price,
          price7d: p7, price14d: p14, price30d: p30, price60d: p60,
          pnl7dPct: pnl7, pnl14dPct: pnl14, pnl30dPct: pnl30, pnl60dPct: pnl60,
          maxGain30dPct: mfe30, maxGain60dPct: mfe60,
          outcome7d: out(pnl7), outcome14d: out(pnl14), outcome30d: out(pnl30), outcome60d: out(pnl60),
          evaluatedAt: pnl60 !== null || mfe60 !== null ? new Date() : null,
          signals: s.signalsJson as never,
        },
        update: {
          price7d: p7, price14d: p14, price30d: p30, price60d: p60,
          pnl7dPct: pnl7, pnl14dPct: pnl14, pnl30dPct: pnl30, pnl60dPct: pnl60,
          maxGain30dPct: mfe30, maxGain60dPct: mfe60,
          outcome7d: out(pnl7), outcome14d: out(pnl14), outcome30d: out(pnl30), outcome60d: out(pnl60),
          evaluatedAt: pnl60 !== null || mfe60 !== null ? new Date() : null,
        },
      })
      recorded++
      if (pnl30 !== null) evaluated++
    }
    console.log(`[moonshot-backfill] ${date}: ${signals.length} signals`)
  }

  console.log(`[moonshot-backfill] DONE — recorded ${recorded} rows, ${evaluated} with 30d eval`)
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error('[moonshot-backfill] failed:', e.message)
  await prisma.$disconnect()
  process.exit(1)
})
