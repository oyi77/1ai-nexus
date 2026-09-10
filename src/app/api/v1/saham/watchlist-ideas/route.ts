// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/watchlist-ideas — combined value + accumulation
// screening for IDX stocks.
//
// Value screen: PER < sector median, PBV < 1, ROE > 15%, DER < 1,
//               dividendYield > 3%
// Accumulation: foreign net-buy streak >= 3 sessions (from session data)
//
// Works even without session data — value screen runs on screener +
// fundamentals alone. Accumulation signals appear once session data
// is harvested.
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
  foreignNetStreakDays: number
  foreignNetStreakDir: 'accumulation' | 'distribution' | null
  estNetValueIdr: number
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
    // Latest screener snapshot
    const latestScreener = await prisma.idxScreenerSnapshot.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    const screenerByCode = new Map<string, { per: number | null; pbv: number | null; roe: number | null; der: number | null; marketCap: number | null; sector: string; name: string; price: number | null; change1d: number | null; close: number | null }>()
    if (latestScreener) {
      const screenerRows = await prisma.idxScreenerSnapshot.findMany({
        where: { snapshotDate: latestScreener.snapshotDate },
      })
      for (const r of screenerRows) screenerByCode.set(r.code, { per: r.per, pbv: r.pbv, roe: r.roe, der: r.der, marketCap: r.marketCap, sector: r.sector, name: r.name, price: r.price, change1d: r.change1d, close: r.price })
    }

    // Dividend yield from fundamentals
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

    if (screenerByCode.size === 0) {
      return apiSuccess({ tradeDate: '', screenerDate: '', count: 0, ideas: [] })
    }

    // Sector medians for PER
    const sectorPerValues = new Map<string, number[]>()
    for (const [, s] of screenerByCode) {
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

    // BULK: streak data — single query for last 30 sessions
    const distinctDates = await prisma.idxSahamSession.findMany({
      distinct: ['tradeDate'],
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
      take: 30,
    })
    const dates = distinctDates.map((d) => d.tradeDate).sort()
    const streakMap = new Map<string, { days: number; dir: 'accumulation' | 'distribution' | null; latestNetVol: number; latestClose: number; estNetValue: number }>()

    if (dates.length > 0) {
      const sessionRows = await prisma.idxSahamSession.findMany({
        where: { tradeDate: { in: dates } },
        select: { code: true, tradeDate: true, foreignBuy: true, foreignSell: true, close: true },
      })
      // Group by code
      const byCode = new Map<string, Array<{ date: string; fbuy: number; fsell: number; close: number }>>()
      for (const r of sessionRows) {
        const arr = byCode.get(r.code) ?? []
        arr.push({ date: r.tradeDate, fbuy: r.foreignBuy, fsell: r.foreignSell, close: r.close })
        byCode.set(r.code, arr)
      }
      for (const [code, rows] of byCode) {
        let days = 0
        let dir: 'accumulation' | 'distribution' | null = null
        for (let i = rows.length - 1; i >= 0; i--) {
          const s = rows[i]
          const net = s.fbuy - s.fsell
          if (net === 0) break
          const cur: 'accumulation' | 'distribution' = net > 0 ? 'accumulation' : 'distribution'
          if (dir === null) dir = cur
          else if (cur !== dir) break
          days++
        }
        const latest = rows[rows.length - 1]
        const latestNetVol = latest ? latest.fbuy - latest.fsell : 0
        streakMap.set(code, { days, dir, latestNetVol, latestClose: latest?.close ?? 0, estNetValue: latestNetVol * (latest?.close ?? 0) })
      }
    }

    const ideas: WatchlistIdea[] = []
    for (const [code, fund] of screenerByCode) {
      const dyInfo = fundByCode.get(code)
      const per = num(fund.per)
      const pbv = num(fund.pbv)
      const roe = num(fund.roe)
      const der = num(fund.der)
      const dy = num(dyInfo?.dividendYield)
      const sector = fund.sector || 'Unknown'
      const perMedian = sectorPerMedian.get(sector) ?? NaN

      // Value score: count of bullish conditions met (0-5)
      let valueScore = 0
      if (!Number.isNaN(per) && per > 0 && per < perMedian) valueScore++
      if (!Number.isNaN(pbv) && pbv > 0 && pbv < 1) valueScore++
      if (!Number.isNaN(roe) && roe > 15) valueScore++
      if (!Number.isNaN(der) && der > 0 && der < 1) valueScore++
      if (!Number.isNaN(dy) && dy > 3) valueScore++

      // Accumulation score: streak days (capped at 5)
      const streak = streakMap.get(code)
      const accumulationScore = streak?.dir === 'accumulation' ? Math.min(streak.days, 5) : 0

      const combinedScore = valueScore * valueWeight + accumulationScore * accumWeight

      if (combinedScore >= minScore) {
        const close = fund.close ?? 0
        ideas.push({
          code,
          name: fund.name,
          sector,
          close,
          changePct: fund.change1d ?? 0,
          per: fund.per,
          pbv: fund.pbv,
          roe: fund.roe,
          der: fund.der,
          dividendYield: dyInfo?.dividendYield ?? null,
          marketCap: fund.marketCap,
          foreignNetStreakDays: streak?.days ?? 0,
          foreignNetStreakDir: streak?.dir ?? null,
          estNetValueIdr: streak?.estNetValue ?? 0,
          valueScore,
          accumulationScore,
          combinedScore,
        })
      }
    }

    ideas.sort((a, b) => b.combinedScore - a.combinedScore || b.estNetValueIdr - a.estNetValueIdr)

    return apiSuccess({
      tradeDate: latestScreener?.snapshotDate ?? '',
      screenerDate: latestScreener?.snapshotDate ?? '',
      fundamentalsDate: latestFund?.snapshotDate ?? '',
      sessionDates: dates.length,
      count: ideas.length,
      ideas: ideas.slice(0, limit),
    })
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
