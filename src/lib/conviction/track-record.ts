// ─────────────────────────────────────────────────────────────
// Conviction Track Record — the PROOF layer.
// Every conviction emission is persisted; after a horizon we
// measure the actual price move and classify win/loss. This lets
// the app show "signals >80 conviction win 72% of the time" —
// the trust that separates a tool from a world-class terminal.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export const HORIZON_HOURS = 24
export const WIN_THRESHOLD_PCT = 0.5 // +0.5% counts as a win for BUY

/** Persist a conviction emission (idempotent per symbol+conviction per day). */
export async function recordConvictionSignal(params: {
  symbol: string
  market: string
  conviction: number
  action: string
  direction: string
  price?: number
  reasons?: Array<{ text: string; weight: number }>
}): Promise<void> {
  try {
    await prisma.convictionSignal.create({
      data: {
        symbol: params.symbol.toUpperCase(),
        market: params.market,
        conviction: params.conviction,
        action: params.action,
        direction: params.direction,
        price: params.price,
        reasons: params.reasons ? (params.reasons as unknown as object) : undefined,
      },
    })
  } catch (err) {
    // Never break the main conviction request on persistence failure.
    console.error('[conviction] record track signal failed:', (err as Error).message)
  }
}

/** Evaluate past signals that have matured (price data available after horizon). */
export async function evaluateTrackRecord(): Promise<{
  evaluated: number
  wins: number
  losses: number
  winRate: number
}> {
  // Pick signals older than HORIZON that have a price but no outcome yet.
  const cutoff = new Date(Date.now() - HORIZON_HOURS * 60 * 60 * 1000)
  const pending = await prisma.convictionSignal.findMany({
    where: { price: { not: null }, outcome: null, emittedAt: { lt: cutoff } },
    take: 200,
    orderBy: { emittedAt: 'asc' },
  })

  let wins = 0, losses = 0, evaluated = 0
  for (const s of pending) {
    // Fetch current price for this symbol (crypto USDT / IDX) via a fresh quote.
    const current = await fetchCurrentPrice(s.symbol.toUpperCase(), s.market)
    if (current == null) continue // skip — not evaluable this cycle

    const priceAt = s.price!
    const pnlPercent = priceAt > 0 ? ((current - priceAt) / priceAt) * 100 : 0
    // BUY wins if price rose; SELL wins if price fell; WAIT is not scored.
    const isWin = s.action === 'BUY'
      ? pnlPercent > WIN_THRESHOLD_PCT
      : s.action === 'SELL'
        ? pnlPercent < -WIN_THRESHOLD_PCT
        : null // WAIT → no score

    await prisma.convictionSignal.update({
      where: { id: s.id },
      data: {
        priceAfter: current,
        pnlPercent,
        outcome: isWin === null ? 'na' : isWin ? 'win' : 'loss',
        evaluatedAt: new Date(),
      },
    })
    evaluated++
    if (isWin === true) { wins++; continue }
    if (isWin === false) { losses++; continue }
  }

  const scored = wins + losses
  return { evaluated, wins, losses, winRate: scored > 0 ? (wins / scored) * 100 : 0 }
}

/** Aggregate win-rate by conviction bucket: 80+, 60-79, 40-59, <40. */
export async function getTrackAccuracy(): Promise<{
  total: number
  evaluated: number
  overallWinRate: number
  buckets: Array<{ label: string; signals: number; evaluated: number; winRate: number }>
}> {
  const all = await prisma.convictionSignal.findMany({
    where: { outcome: { in: ['win', 'loss'] } },
    select: { conviction: true, outcome: true },
  })

  const bucketOf = (c: number) =>
    c >= 80 ? '80+' : c >= 60 ? '60-79' : c >= 40 ? '40-59' : '<40'
  const labels = ['80+', '60-79', '40-59', '<40'] as const
  const buckets = labels.map((label) => {
    const rows = all.filter((s) => bucketOf(s.conviction) === label)
    const wins = rows.filter((s) => s.outcome === 'win').length
    const scored = rows.length
    return { label, signals: scored, evaluated: scored, winRate: scored > 0 ? (wins / scored) * 100 : 0 }
  })

  const scored = all.length
  const wins = all.filter((s) => s.outcome === 'win').length
  return {
    total: await prisma.convictionSignal.count(),
    evaluated: scored,
    overallWinRate: scored > 0 ? (wins / scored) * 100 : 0,
    buckets,
  }
}

/** Fetch a current price for a symbol. Crypto → Binance USDT; IDX → screener snapshot. */
async function fetchCurrentPrice(symbol: string, market: string): Promise<number | null> {
  try {
    if (market === 'CRYPTO') {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`, {
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return null
      const d = (await res.json()) as { price?: string }
      const p = Number(d.price)
      return Number.isFinite(p) ? p : null
    }
    // IDX: reuse the screener snapshot (price field).
    const { getScreenerStock } = await import('@/lib/modules/market/provider/idx-screener')
    const row = await getScreenerStock(symbol)
    return row?.price ?? null
  } catch {
    return null
  }
}