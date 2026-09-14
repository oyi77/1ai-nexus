// ─────────────────────────────────────────────────────────────
// Alpha Track Record Backfill — point-in-time replay.
//
// For each historical session date D (with enough prior history):
//   1. Compute alpha using ONLY sessions up to D (momentum fields
//      derived from session closes — no lookahead on prices).
//   2. Record buy/strong-buy signals with signalDate=D.
//   3. Evaluate PnL at D+7/14/30 calendar days from session prices.
//
// Caveat (documented): fundamentals (PER/PBV/ROE/DER/marketCap) come
// from the LATEST screener snapshot — they drift slowly, but this is
// not perfectly point-in-time. Price/momentum fields ARE.
//
// Run: npx tsx src/scripts/alpha-track-backfill.ts
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { computeAlpha } from '@/lib/conviction/alpha-engine'

const WIN_THRESHOLD = 0.5

function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
}
function std(a: number[]): number {
  if (a.length < 2) return 1
  const m = mean(a)
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1
}

type SessionRow = {
  code: string; tradeDate: string
  open: number; high: number; low: number; close: number
  volume: number; value: number; foreignBuy: number; foreignSell: number
}

async function main() {
  // 1. Load all sessions, grouped + sorted by code.
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
  console.log(`[alpha-backfill] ${allSessions.length} sessions, ${allDates.length} dates (${allDates[0]} → ${allDates[allDates.length - 1]})`)

  // 2. Latest screener + fundamentals (fundamentals caveat applies).
  const latestScreenerDate = await prisma.idxScreenerSnapshot.findFirst({ orderBy: { snapshotDate: 'desc' }, select: { snapshotDate: true } })
  if (!latestScreenerDate) { console.log('no screener data'); return }
  const screenerRows = await prisma.idxScreenerSnapshot.findMany({ where: { snapshotDate: latestScreenerDate.snapshotDate } })
  const fundRows = await prisma.idxFundamentals.findMany({ where: { snapshotDate: (await prisma.idxFundamentals.findFirst({ orderBy: { snapshotDate: 'desc' }, select: { snapshotDate: true } }))?.snapshotDate } })
  const _fundByCode = new Map(fundRows.map((f) => [f.code, f]))
  const screenerByCode = new Map(screenerRows.map((s) => [s.code, s]))

  // Universe stats (same winsorization as the route).
  const pers: number[] = [], roes: number[] = [], pbvs: number[] = []
  for (const s of screenerRows) {
    if (s.per && s.per > 0 && s.per <= 100) pers.push(s.per)
    if (s.roe !== null && s.roe >= -50 && s.roe <= 100) roes.push(s.roe)
    if (s.pbv && s.pbv > 0 && s.pbv <= 20) pbvs.push(s.pbv)
  }
  const universeStats = { perMean: mean(pers), perStd: std(pers), roeMean: mean(roes), roeStd: std(roes), pbvMean: mean(pbvs), pbvStd: std(pbvs) }

  // Date index for horizon lookups (first session >= D+N calendar days).
  const dateIdx = new Map(allDates.map((d, i) => [d, i]))
  function futurePrice(code: string, fromDate: string, horizonDays: number): number | null {
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

  // Broker board per date (loaded lazily per signal date).
  const brokerCache = new Map<string, Array<{ firm: string; value: number; volume: number }>>()
  async function brokersFor(date: string) {
    const hit = brokerCache.get(date)
    if (hit) return hit
    const rows = await prisma.idxBrokerBoard.findMany({ where: { tradeDate: date }, select: { firm: true, value: true, volume: true } })
    brokerCache.set(date, rows)
    return rows
  }

  // 3. Replay over dates with >= 25 prior sessions (engine lookbacks warm).
  const START_IDX = 25
  let recorded = 0, evaluated = 0
  const MIN_PRIOR = 5

  for (let di = START_IDX; di < allDates.length; di++) {
    const date = allDates[di]
    const brokers = await brokersFor(date)
    const signals: Array<{ code: string; sector: string; alphaScore: number; verdict: string; price: number; reasons: string[]; signalsJson: unknown }> = []

    for (const [code, sessions] of byCode) {
      const upto = sessions.filter((s) => s.tradeDate <= date)
      if (upto.length < MIN_PRIOR) continue
      const scr = screenerByCode.get(code)
      if (!scr) continue
      const last = upto[upto.length - 1]
      if (last.tradeDate !== date) continue // no trade that day

      // Point-in-time momentum fields from sessions (no lookahead).
      const close = last.close
      const chg = (days: number): number | null => {
        if (upto.length <= days) return null
        const past = upto[upto.length - 1 - days].close
        return past > 0 ? ((close - past) / past) * 100 : null
      }
      const screenerInput = {
        per: scr.per, pbv: scr.pbv, roe: scr.roe, der: scr.der,
        change1d: chg(1), change4w: chg(20), change13w: chg(65), change26w: chg(130), change52w: chg(260),
        marketCap: scr.marketCap,
        price: close,
        high52w: Math.max(...upto.map((s) => s.high)),
        low52w: Math.min(...upto.map((s) => s.low)),
      }
      const result = computeAlpha({
        sessions: upto.map((s) => ({ date: s.tradeDate, close: s.close, volume: s.volume, value: s.value, foreignBuy: s.foreignBuy, foreignSell: s.foreignSell, high: s.high, low: s.low, open: s.open })),
        brokers,
        screener: screenerInput,
        universeStats,
      })
      if (result.verdict === 'buy' || result.verdict === 'strong-buy') {
        signals.push({ code, sector: scr.sector || 'Unknown', alphaScore: result.totalScore, verdict: result.verdict, price: close, reasons: result.topReasons, signalsJson: result.signals })
      }
    }

    // 4. Upsert signals for this date.
    for (const s of signals) {
      // Evaluate horizons from session prices.
      const p7 = futurePrice(s.code, date, 7)
      const p14 = futurePrice(s.code, date, 14)
      const p30 = futurePrice(s.code, date, 30)
      const pnl7 = p7 ? (p7 / s.price - 1) * 100 : null
      const pnl14 = p14 ? (p14 / s.price - 1) * 100 : null
      const pnl30 = p30 ? (p30 / s.price - 1) * 100 : null
      const out = (p: number | null) => (p === null ? null : p >= WIN_THRESHOLD ? 'win' : 'loss')
      const fullyEvaluated = pnl30 !== null

      await prisma.alphaTrackRecord.upsert({
        where: { code_signalDate_lane: { code: s.code, signalDate: date, lane: 'alpha' } },
        create: {
          code: s.code, sector: s.sector, signalDate: date,
          alphaScore: Math.round(s.alphaScore), verdict: s.verdict, priceAtSignal: s.price,
          price7d: p7, price14d: p14, price30d: p30,
          pnl7dPct: pnl7, pnl14dPct: pnl14, pnl30dPct: pnl30,
          outcome7d: out(pnl7), outcome14d: out(pnl14), outcome30d: out(pnl30),
          evaluatedAt: fullyEvaluated ? new Date() : null,
          signals: s.signalsJson as never,
        },
        update: {
          price7d: p7, price14d: p14, price30d: p30,
          pnl7dPct: pnl7, pnl14dPct: pnl14, pnl30dPct: pnl30,
          outcome7d: out(pnl7), outcome14d: out(pnl14), outcome30d: out(pnl30),
          evaluatedAt: fullyEvaluated ? new Date() : null,
        },
      })
      recorded++
      if (fullyEvaluated) evaluated++
    }
    console.log(`[alpha-backfill] ${date}: ${signals.length} signals`)
  }

  console.log(`[alpha-backfill] DONE — recorded ${recorded} signal rows, ${evaluated} fully evaluated (7/14/30d)`)
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error('[alpha-backfill] FATAL:', e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
