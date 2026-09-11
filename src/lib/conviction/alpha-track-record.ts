// ─────────────────────────────────────────────────────────────
// Alpha Track Record — prove the alpha engine works.
//
// Daily cron:
//   1. Record today's buy/strong-buy signals (idempotent per code+date).
//   2. Evaluate matured signals at 7/14/30 day horizons.
//   3. Compute stats: hit rate, avg return, by verdict + sector.
// ─────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db"

const HORIZONS = [7, 14, 30] as const
const WIN_THRESHOLD = 0.5 // +0.5% counts as a win

/** Record today's buy/strong-buy signals. Idempotent per code+date. */
export async function recordAlphaSignals(
  signals: Array<{
    code: string
    sector: string
    alphaScore: number
    verdict: string
    price: number
    reasons: string[]
  }>,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  let recorded = 0

  for (const s of signals) {
    if (s.verdict !== "buy" && s.verdict !== "strong-buy") continue
    if (!s.price || s.price <= 0) continue

    try {
      await prisma.alphaTrackRecord.upsert({
        where: { code_signalDate: { code: s.code, signalDate: today } },
        create: {
          code: s.code,
          sector: s.sector,
          signalDate: today,
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

/** Fetch current price for an IDX stock from the latest screener snapshot. */
async function fetchCurrentPrice(code: string): Promise<number | null> {
  try {
    const latest = await prisma.idxScreenerSnapshot.findFirst({
      orderBy: { snapshotDate: "desc" },
      where: { code },
      select: { price: true },
    })
    return latest?.price ?? null
  } catch {
    return null
  }
}

/** Evaluate matured signals at all horizons. */
export async function evaluateAlphaTrackRecord(): Promise<{
  evaluated: number
  horizons: Record<string, { evaluated: number; wins: number; avgPnl: number }>
}> {
  const today = new Date()
  const horizons: Record<string, { evaluated: number; wins: number; avgPnl: number }> = {}
  let totalEvaluated = 0

  for (const days of HORIZONS) {
    const cutoff = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const field = `price${days}d` as const
    const pnlField = `pnl${days}dPct` as const
    const outcomeField = `outcome${days}d` as const

    // Find signals at this horizon that haven't been evaluated yet
    const whereClause: Record<string, unknown> = {
      signalDate: { lte: cutoffStr },
      priceAtSignal: { gt: 0 },
    }
    whereClause[field] = null
    const pending = await prisma.alphaTrackRecord.findMany({
      where: whereClause as any,
      take: 200,
      orderBy: { signalDate: "asc" },
    })



    let wins = 0
    let pnlSum = 0
    let evaluated = 0

    for (const s of pending) {
      const current = await fetchCurrentPrice(s.code)
      if (current == null) continue

      const priceAt = s.priceAtSignal!
      const pnlPct = priceAt > 0 ? ((current - priceAt) / priceAt) * 100 : 0
      const isWin = pnlPct > WIN_THRESHOLD

      const updateData: Record<string, unknown> = { evaluatedAt: new Date() }
      updateData[field] = current
      updateData[pnlField] = pnlPct
      updateData[outcomeField] = isWin ? "win" : "loss"
      await prisma.alphaTrackRecord.update({
        where: { id: s.id },
        data: updateData as any,
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

/** Compute aggregate stats: hit rate, avg return, by verdict + sector. */
export async function getAlphaTrackStats(): Promise<{
  total: number
  evaluated: number
  overallWinRate: number
  avgReturn7d: number
  avgReturn14d: number
  avgReturn30d: number
  byVerdict: Array<{ verdict: string; count: number; winRate: number; avgReturn: number }>
  bySector: Array<{ sector: string; count: number; winRate: number; avgReturn: number }>
  recent: Array<{ code: string; signalDate: string; verdict: string; alphaScore: number; pnl7d: number | null; pnl14d: number | null; pnl30d: number | null }>
}> {
  const all = await prisma.alphaTrackRecord.findMany({
    where: { outcome7d: { not: null } },
    orderBy: { signalDate: "desc" },
    take: 500,
  })

  const evaluated = all.length
  const wins = all.filter((s) => s.outcome7d === "win").length
  const overallWinRate = evaluated > 0 ? (wins / evaluated) * 100 : 0

  const returns7d = all.filter((s) => s.pnl7dPct != null).map((s) => s.pnl7dPct!)
  const returns14d = all.filter((s) => s.pnl14dPct != null).map((s) => s.pnl14dPct!)
  const returns30d = all.filter((s) => s.pnl30dPct != null).map((s) => s.pnl30dPct!)

  // By verdict
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
      avgReturn: r7.length > 0 ? r7.reduce((a, b) => a + b, 0) / r7.length : 0,
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
        avgReturn: r7.length > 0 ? r7.reduce((a, b) => a + b, 0) / r7.length : 0,
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const recent = all.slice(0, 20).map((s) => ({
    code: s.code,
    signalDate: s.signalDate,
    verdict: s.verdict,
    alphaScore: s.alphaScore,
    pnl7d: s.pnl7dPct,
    pnl14d: s.pnl14dPct,
    pnl30d: s.pnl30dPct,
  }))

  return {
    total: await prisma.alphaTrackRecord.count(),
    evaluated,
    overallWinRate,
    avgReturn7d: returns7d.length > 0 ? returns7d.reduce((a, b) => a + b, 0) / returns7d.length : 0,
    avgReturn14d: returns14d.length > 0 ? returns14d.reduce((a, b) => a + b, 0) / returns14d.length : 0,
    avgReturn30d: returns30d.length > 0 ? returns30d.reduce((a, b) => a + b, 0) / returns30d.length : 0,
    byVerdict,
    bySector,
    recent,
  }
}
