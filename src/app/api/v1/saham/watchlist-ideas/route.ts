// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/watchlist-ideas — combined value + accumulation
// screening for IDX stocks.
//
// Merges:
//   Value screen: PER < sector median, PBV < 1, ROE > 15%, DER < 1,
//                 dividendYield > 3%
//   Accumulation: foreign net-buy streak >= 3 sessions, volume spike
//                 with flat price, broker board net
//
// Params:
//   ?minScore=1        minimum combined score to include (default 1)
//   ?limit=50          max results (default 50, max 200)
//   ?valueWeight=0.5   weight for value score (0-1), accumulation gets 1-w
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface WatchlistIdea {
  code: string
  name: string
  sector: string
  close: number
  changePct: number
  per: number | null
  pbv: number | null
  roe: number | null
  der: number | null
  dividendYield: number | null
  marketCap: number | null
  // signals
  foreignNetStreakDays: number
  foreignNetStreakDir: 'accumulation' | 'distribution' | null
  estNetValueIdr: number
  // scores
  valueScore: number
  accumulationScore: number
  combinedScore: number
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const minScore = Math.max(0, Number(p.get('minScore') ?? 1))
  const limit = Math.min(Math.max(1, Number(p.get('limit') ?? 50)), 200)
  const valueWeight = Math.min(1, Math.max(0, Number(p.get('valueWeight') ?? 0.5)))
  const accumWeight = 1 - valueWeight

  try {
    // Latest session date
    const latest = await prisma.idxSahamSession.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) return apiSuccess({ tradeDate: '', count: 0, ideas: [] })

    const tradeDate = latest.tradeDate

    // Latest session rows
    const sessionRows = await prisma.idxSahamSession.findMany({ where: { tradeDate } })

    // Latest screener snapshot for fundamentals
    const latestScreener = await prisma.idxScreenerSnapshot.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    const screenerByCode = new Map<string, { per: number | null; pbv: number | null; roe: number | null; der: number | null; marketCap: number | null; sector: string; name: string }>()
    if (latestScreener) {
      const screenerRows = await prisma.idxScreenerSnapshot.findMany({
        where: { snapshotDate: latestScreener.snapshotDate },
      })
      for (const r of screenerRows) screenerByCode.set(r.code, { per: r.per, pbv: r.pbv, roe: r.roe, der: r.der, marketCap: r.marketCap, sector: r.sector, name: r.name })
    }

    // Dividend yield from fundamentals table
    const latestFund = await prisma.idxFundamentals.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    const fundByCode = new Map<string, { dividendYield: number | null }>()
    if (latestFund) {
      const fundRows = await prisma.idxFundamentals.findMany({
        where: { snapshotDate: latestFund.snapshotDate },
        select: { code: true, dividendYield: true },
      })
      for (const r of fundRows) fundByCode.set(r.code, { dividendYield: r.dividendYield })
    }


    // Sector medians for PER
    const sectorPerValues = new Map<string, number[]>()
    for (const [code, s] of screenerByCode) {
      const per = num(s.per)
      if (!Number.isNaN(per) && per > 0) {
        const arr = sectorPerValues.get(s.sector) ?? []
        arr.push(per)
        sectorPerValues.set(s.sector, arr)
      }
    }
    const sectorPerMedian = new Map<string, number>()
    for (const [sector, vals] of sectorPerValues) {
      vals.sort((a, b) => a - b)
      sectorPerMedian.set(sector, vals[Math.floor(vals.length / 2)])
    }

    // Foreign streaks (last 30 sessions)
    const distinctDates = await prisma.idxSahamSession.findMany({
      distinct: ['tradeDate'],
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
      take: 30,
    })
    const dates = distinctDates.map((d) => d.tradeDate).sort()

    const streakMap = new Map<string, { days: number; dir: 'accumulation' | 'distribution' | null }>()
    const sessionMap = new Map<string, Map<string, { fbuy: number; fsell: number }>>()
    for (const date of dates) {
      const rows = await prisma.idxSahamSession.findMany({
        where: { tradeDate: date },
        select: { code: true, foreignBuy: true, foreignSell: true },
      })
      for (const r of rows) {
        let m = sessionMap.get(r.code)
        if (!m) {
          m = new Map()
          sessionMap.set(r.code, m)
        }
        m.set(date, { fbuy: r.foreignBuy, fsell: r.foreignSell })
      }
    }
    const computeStreak = (code: string): { days: number; dir: 'accumulation' | 'distribution' | null } => {
      const cached = streakMap.get(code)
      if (cached) return cached
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
      streakMap.set(code, out)
      return out
    }

    const ideas: WatchlistIdea[] = []
    for (const row of sessionRows) {
      const fund = screenerByCode.get(row.code)
      const dyInfo = fundByCode.get(row.code)
      const per = num(fund?.per)
      const pbv = num(fund?.pbv)
      const roe = num(fund?.roe)
      const der = num(fund?.der)
      const dy = num(dyInfo?.dividendYield)
      const sector = fund?.sector ?? 'Unknown'
      const perMedian = sectorPerMedian.get(sector) ?? NaN

      // Value score: count of bullish conditions met (0-5)
      let valueScore = 0
      if (!Number.isNaN(per) && per > 0 && per < perMedian) valueScore++
      if (!Number.isNaN(pbv) && pbv > 0 && pbv < 1) valueScore++
      if (!Number.isNaN(roe) && roe > 15) valueScore++
      if (!Number.isNaN(der) && der > 0 && der < 1) valueScore++
      if (!Number.isNaN(dy) && dy > 3) valueScore++

      // Accumulation score: streak days (capped at 5)
      const streak = computeStreak(row.code)
      const netVol = row.foreignBuy - row.foreignSell
      const estNetValueIdr = netVol * row.close
      const accumulationScore = streak.dir === 'accumulation' ? Math.min(streak.days, 5) : 0

      const combinedScore = valueScore * valueWeight + accumulationScore * accumWeight

      if (combinedScore >= minScore) {
        ideas.push({
          code: row.code,
          name: fund?.name ?? row.name,
          sector,
          close: row.close,
          changePct: row.prev > 0 ? ((row.close - row.prev) / row.prev) * 100 : 0,
          per: fund?.per ?? null,
          pbv: fund?.pbv ?? null,
          roe: fund?.roe ?? null,
          der: fund?.der ?? null,
          dividendYield: dyInfo?.dividendYield ?? null,
          marketCap: fund?.marketCap ?? null,
          foreignNetStreakDays: streak.days,
          foreignNetStreakDir: streak.dir,
          estNetValueIdr,
          valueScore,
          accumulationScore,
          combinedScore,
        })
      }
    }

    ideas.sort((a, b) => b.combinedScore - a.combinedScore || b.estNetValueIdr - a.estNetValueIdr)

    return apiSuccess({
      tradeDate,
      screenerDate: latestScreener?.snapshotDate ?? '',
      count: ideas.length,
      ideas: ideas.slice(0, limit),
    })
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
