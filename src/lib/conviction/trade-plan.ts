// ─────────────────────────────────────────────────────────────
// Retail Trade Plan — turns an alpha idea into an executable
// trade: entry, stop-loss, targets, R:R, and position sizing.
//
// Design rules (retail-first):
//   • Entry = latest close (market-executable).
//   • Stop  = min(recent swing low, entry − 2×ATR14), capped so a
//     normal IDX fluctuation (~5%) doesn't whipsaw out.
//   • Targets = 1R / 2R / 3R above entry (R = entry − stop).
//   • Sizing = risk-based: shares = (capital × riskPct) / (entry − stop),
//     rounded to IDX board lot (100 shares).
// Pure functions; no I/O.
// ─────────────────────────────────────────────────────────────

export interface TradePlanInput {
  /** OHLCV sessions, oldest → newest. */
  sessions: Array<{
    date: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  /** Capital the user is willing to deploy (IDR). */
  capital: number
  /** Fraction of capital at risk if stop hits (0.005–0.05 sensible). */
  riskPct: number
}

export interface TradePlan {
  entry: number
  stop: number
  stopPct: number
  riskPerShare: number
  targets: Array<{ level: number; pct: number; rMultiple: number }>
  riskReward: number
  /** Position sizing (only valid when stop > 0 and entry > stop). */
  sizing: {
    shares: number
    lots: number
    allocation: number
    allocationPct: number
    riskAmount: number
  } | null
  atr14: number | null
  swingLow: number | null
  warnings: string[]
}

function round(v: number, dp = 0): number {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

/** Average True Range (14) from OHLC sessions. */
export function atr14(sessions: Array<{ high: number; low: number; close: number }>): number | null {
  if (sessions.length < 2) return null
  const trs: number[] = []
  for (let i = 1; i < sessions.length; i++) {
    const h = sessions[i].high
    const l = sessions[i].low
    const pc = sessions[i - 1].close
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
  }
  const recent = trs.slice(-14)
  if (recent.length === 0) return null
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length
  return avg > 0 ? avg : null
}

/** Lowest low over the last N sessions (swing-low stop anchor). */
export function swingLow(sessions: Array<{ low: number }>, lookback = 10): number | null {
  const slice = sessions.slice(-lookback)
  if (slice.length === 0) return null
  return Math.min(...slice.map((s) => s.low))
}

/**
 * Build a complete trade plan from sessions + capital.
 * Returns null-sized sizing when inputs make the plan invalid
 * (e.g. price 0, stop above entry) — consumers must render the
 * warnings instead of silently showing garbage numbers.
 */
export function buildTradePlan(input: TradePlanInput): TradePlan {
  const { sessions, capital, riskPct } = input
  const warnings: string[] = []

  const last = sessions[sessions.length - 1]
  const entry = last ? last.close : 0
  if (!entry || entry <= 0) {
    return { entry: 0, stop: 0, stopPct: 0, riskPerShare: 0, targets: [], riskReward: 0, sizing: null, atr14: null, swingLow: null, warnings: ['No price data — plan unavailable.'] }
  }
  if (sessions.length < 6) warnings.push('Thin history (<6 sessions) — stop/targets less reliable.')

  const a = atr14(sessions)
  const swing = swingLow(sessions)

  // Stop: max of (swing-low buffer) and (entry − 2×ATR), but never
  // tighter than 3% (whipsaw) or wider than 12% (account damage).
  let stop = entry * 0.94 // default −6%
  const candidates: number[] = []
  if (swing && swing < entry) candidates.push(swing - a! * 0.25) // just below swing
  if (a && a > 0) candidates.push(entry - 2 * a)
  if (candidates.length > 0) stop = Math.max(...candidates)
  const minStop = entry * 0.88 // −12% hard floor
  const maxStop = entry * 0.97 // −3% hard ceiling
  stop = Math.max(minStop, Math.min(maxStop, stop))

  const riskPerShare = entry - stop
  const stopPct = (riskPerShare / entry) * 100

  const targets = [1, 2, 3].map((r) => ({
    level: round(entry + riskPerShare * r),
    pct: round(((riskPerShare * r) / entry) * 100, 1),
    rMultiple: r,
  }))

  // Position sizing — risk-based, rounded to IDX board lot (100).
  let sizing: TradePlan['sizing'] = null
  if (riskPerShare > 0 && capital > 0 && riskPct > 0) {
    const riskAmount = capital * riskPct
    const rawShares = riskAmount / riskPerShare
    const lots = Math.max(1, Math.floor(rawShares / 100))
    const shares = lots * 100
    const allocation = shares * entry
    if (allocation > capital) warnings.push('Plan allocation exceeds capital at 1 lot — increase capital or skip.')
    sizing = {
      shares,
      lots,
      allocation: round(allocation),
      allocationPct: round((allocation / capital) * 100, 1),
      riskAmount: round(riskAmount),
    }
  } else if (capital <= 0) {
    warnings.push('No capital set — sizing hidden.')
  }

  return {
    entry: round(entry),
    stop: round(stop),
    stopPct: round(stopPct, 1),
    riskPerShare: round(riskPerShare),
    targets,
    riskReward: round(3, 1), // T3 = 3R by construction
    sizing,
    atr14: a !== null ? round(a) : null,
    swingLow: swing !== null ? round(swing) : null,
    warnings,
  }
}
