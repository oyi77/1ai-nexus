// ─────────────────────────────────────────────────────────────
// Conviction Track Record — the PROOF layer.
// Every conviction emission is persisted; after a horizon we
// measure the actual price move and classify win/loss. This lets
// the app show "signals >80 conviction win 72% of the time" —
// the trust that separates a tool from a world-class terminal.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export const HORIZON_HOURS = 24 // crypto wall-clock gate only; IDX uses session offset
export const IDX_HORIZON_SESSIONS = 1 // IDX: resolve the 1st session strictly after emission
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
    const day = new Date().toISOString().slice(0, 10)
    const dupe = await prisma.convictionSignal.findFirst({
      where: {
        symbol: params.symbol.toUpperCase(),
        market: params.market,
        action: params.action,
        emittedAt: { gte: new Date(day + 'T00:00:00Z'), lt: new Date(day + 'T23:59:59Z') },
      },
      select: { id: true },
    })
    if (dupe) return // one emission per symbol+action per day — the 09-18
    // flood wrote 338 dupes/symbol when TTL recomputes raced; dupes bias
    // the base rate toward flood-day regimes, never new information.
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

/** Evaluate past signals that have matured (price data available after horizon).
 * Semantics (measured 2026-09-20): IDX horizon = next trading session close
 * after emission (market is daily; wall-clock 24h is meaningless across
 * weekends/holidays). evaluatedAt is the settling session's close, so elapsed
 * time is truthful. Crypto keeps the 24h wall-clock gate. */
export async function evaluateTrackRecord(): Promise<{
  evaluated: number
  wins: number
  losses: number
  winRate: number
}> {
  // Pick signals older than HORIZON that have a price but no outcome yet.
  // IDX rows are gated on a forward session existing (session-based horizon);
  // crypto rows keep the wall-clock gate.
  const cutoff = new Date(Date.now() - HORIZON_HOURS * 60 * 60 * 1000)
  const pending = await prisma.convictionSignal.findMany({
    where: { price: { not: null }, outcome: null, emittedAt: { lt: cutoff } },
    take: 200,
    orderBy: { emittedAt: 'asc' },
  })

  let wins = 0, losses = 0, evaluated = 0
  for (const s of pending) {
    // IDX: resolve the forward session close strictly after emission — never
    // the emit snapshot itself. Rows with zero/negative stored price need a
    // forward session too; skip (never loss) until one exists.
    let current: number | null
    let settledAt: Date | null = null
    if (s.market === 'IDX') {
      const emitDate = s.emittedAt.toISOString().slice(0, 10)
      const fwd = await fetchIdxForwardClose(s.symbol.toUpperCase(), emitDate, IDX_HORIZON_SESSIONS)
      if (fwd == null) continue // forward session not harvested yet — skip, not evaluable
      current = fwd.close
      settledAt = new Date(fwd.tradeDate + 'T15:00:00+07:00')
    } else {
      // Fetch current price for crypto via a fresh quote.
      current = await fetchCurrentPrice(s.symbol.toUpperCase(), s.market)
    }
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
        evaluatedAt: settledAt ?? new Date(),
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

/** Forward session close for IDX — the price that actually existed after the signal.
 * Reads IdxSahamSession (dated market rows), never the emit screener snapshot,
 * so evaluation can never compare a price against itself. Returns null when
 * no forward session exists yet — the caller must SKIP, never score. */
async function fetchIdxForwardClose(symbol: string, emitDate: string, horizonSessions = 1): Promise<{ close: number; tradeDate: string } | null> {
  try {
    const rows = await prisma.idxSahamSession.findMany({
      where: { code: symbol.toUpperCase(), tradeDate: { gt: emitDate } },
      orderBy: { tradeDate: 'asc' },
      take: horizonSessions,
      select: { close: true, tradeDate: true },
    })
    if (rows.length < horizonSessions) return null
    const target = rows[rows.length - 1]
    if (!(target.close > 0)) return null
    return { close: target.close, tradeDate: target.tradeDate }
  } catch {
    return null
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