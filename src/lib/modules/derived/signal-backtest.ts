// ─────────────────────────────────────────────────────────────
// Signal backtest + demo portfolio.
//
// This exists because the repo's older `audit-backtest` compares an entry to
// TODAY's price, which answers "would this still be worth holding?" — not
// "what happened after the signal?". That produced a uniform -99.99% and
// taught us nothing. Here every trade is opened at the bar at/after the
// signal time and closed at a measured horizon, so the number reflects the
// decision, not the passage of time.
//
// Invariants:
//   • NEVER fabricates a price. A bar that cannot be resolved leaves the
//     trade UNPRICEABLE and it is excluded from return statistics.
//   • Entry and exit both come from the SAME bar series (GeckoTerminal
//     OHLCV), so no cross-source basis mismatch invents a profit.
//   • Demo money is virtual: nothing here ever places an order.
//   • Pure functions only — fetching is the caller's job, so the maths is
//     fixture-testable.
// ─────────────────────────────────────────────────────────────

import type { OhlcvBar } from '@/lib/modules/derived/historical-price'

/** Horizons a demo position can be closed at, in hours. */
export const DEMO_HORIZONS = { h1: 1, h4: 4, h24: 24, d7: 168 } as const
export type DemoHorizonKey = keyof typeof DEMO_HORIZONS
export const DEMO_HORIZON_KEYS = Object.keys(DEMO_HORIZONS) as DemoHorizonKey[]

export interface DeliveredSignal {
  contract: string
  /** ISO timestamp of the delivery (the moment the operator was told). */
  at: string
}

export type TradeVerdict = 'TARGET' | 'STOPPED' | 'FLAT' | 'UNPRICEABLE' | 'PENDING'

export interface DemoTrade {
  contract: string
  signalAt: string
  horizon: DemoHorizonKey
  entryPriceUsd: number | null
  exitPriceUsd: number | null
  returnPct: number | null
  verdict: TradeVerdict
}

export interface DemoBacktestConfig {
  /** Fractional move that counts as a win, e.g. 0.5 = +50%. */
  targetPct: number
  /** Fractional loss that stops the trade, e.g. 0.35 = -35%. */
  stopPct: number
  /** Bars within this fraction of flat are NEITHER win nor loss. */
  flatBandPct: number
}

export const DEMO_BACKTEST_DEFAULTS: DemoBacktestConfig = {
  targetPct: 0.5,
  stopPct: 0.35,
  flatBandPct: 0.05,
}

/** Bars are ordered oldest-first by the GeckoTerminal helper. */
function barAtOrAfter(bars: OhlcvBar[], tsMs: number): OhlcvBar | null {
  for (const bar of bars) {
    if (bar.time * 1000 >= tsMs) return bar
  }
  return null
}

/**
 * The bar that CONTAINS `tsMs`: the last bar starting at or before it.
 *
 * A signal delivered 10 minutes into an hourly bar is priced by that bar's
 * close. Using "first bar starting at or after the signal" instead would
 * skip the whole first hour, and for a token younger than one hour it would
 * find nothing at all — the entry would look unpriceable for every fresh
 * signal, which is exactly when the strategy is most active.
 */
export function barCovering(bars: OhlcvBar[], tsMs: number): OhlcvBar | null {
  let found: OhlcvBar | null = null
  for (const bar of bars) {
    if (bar.time * 1000 <= tsMs) found = bar
    else break
  }
  return found
}

/**
 * Price one trade.
 *
 * The entry is the first bar at/after the signal; the exit is the bar closest
 * to the horizon and strictly after the entry bar. A horizon that has not
 * elapsed, or a series too short to cover it, is UNPRICEABLE — never guessed,
 * and never counted as a loss.
 */
export function priceTrade(
  signal: DeliveredSignal,
  horizon: DemoHorizonKey,
  bars: OhlcvBar[],
  nowMs: number,
): DemoTrade {
  const base: DemoTrade = {
    contract: signal.contract,
    signalAt: signal.at,
    horizon,
    entryPriceUsd: null,
    exitPriceUsd: null,
    returnPct: null,
    verdict: 'UNPRICEABLE',
  }

  const signalMs = Date.parse(signal.at)
  if (!Number.isFinite(signalMs)) return base

  const dueMs = signalMs + DEMO_HORIZONS[horizon] * 3_600_000
  // Not yet observable is NOT the same as unpriceable: reporting a young signal
  // as a pricing failure inflates the failure count and hides real gaps.
  if (dueMs > nowMs) return { ...base, verdict: 'PENDING' }

  // Entry: the bar covering the signal moment (its close is the first price
  // the market printed after the alert was delivered).
  const entryBar = barCovering(bars, signalMs)
  if (!entryBar || !(entryBar.close > 0)) return base

  // Exit: the first bar at/after the horizon. It must be strictly later than
  // the entry bar, otherwise the series cannot resolve the holding period.
  const exitBar = barAtOrAfter(bars, dueMs)
  if (!exitBar || exitBar.time <= entryBar.time || !(exitBar.close > 0)) return base

  return {
    ...base,
    entryPriceUsd: entryBar.close,
    exitPriceUsd: exitBar.close,
    returnPct: (exitBar.close - entryBar.close) / entryBar.close,
  }
}

/**
 * Classify a priced trade against the target/stop bands. A trade that never
 * reaches either band is FLAT, which is a real outcome — not a loss.
 */
export function classifyTrade(trade: DemoTrade, config: DemoBacktestConfig): DemoTrade {
  if (trade.returnPct === null) return trade
  let verdict: TradeVerdict
  if (trade.returnPct >= config.targetPct) verdict = 'TARGET'
  else if (trade.returnPct <= -config.stopPct) verdict = 'STOPPED'
  else if (Math.abs(trade.returnPct) <= config.flatBandPct) verdict = 'FLAT'
  else verdict = 'FLAT'
  return { ...trade, verdict }
}

export interface DemoBacktestSummary {
  /** Trades that produced a measurable return. */
  priced: number
  /** Trades excluded because no price series resolved them. */
  unpriceable: number
  /** Trades whose horizon has not elapsed yet — observable, just not yet. */
  pending: number
  targets: number
  stops: number
  flats: number
  /** null when nothing was priced — never a fabricated 0%. */
  winRatePct: number | null
  avgReturnPct: number | null
  medianReturnPct: number | null
  bestReturnPct: number | null
  worstReturnPct: number | null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Aggregate trades into a summary. Unpriceable trades are reported, not scored. */
export function summariseDemoBacktest(trades: DemoTrade[]): DemoBacktestSummary {
  const priced = trades.filter((t) => t.returnPct !== null)
  const returns = priced.map((t) => t.returnPct as number)
  const targets = trades.filter((t) => t.verdict === 'TARGET').length
  const stops = trades.filter((t) => t.verdict === 'STOPPED').length
  const flats = trades.filter((t) => t.verdict === 'FLAT').length
  const decided = targets + stops

  return {
    priced: priced.length,
    unpriceable: trades.filter((t) => t.verdict === 'UNPRICEABLE').length,
    pending: trades.filter((t) => t.verdict === 'PENDING').length,
    targets,
    stops,
    flats,
    winRatePct: decided > 0 ? (targets / decided) * 100 : null,
    avgReturnPct:
      returns.length > 0 ? (returns.reduce((a, b) => a + b, 0) / returns.length) * 100 : null,
    medianReturnPct: median(returns) === null ? null : (median(returns) as number) * 100,
    bestReturnPct: returns.length > 0 ? Math.max(...returns) * 100 : null,
    worstReturnPct: returns.length > 0 ? Math.min(...returns) * 100 : null,
  }
}

// ── Demo portfolio ────────────────────────────────────────────

export interface DemoPortfolioConfig {
  /** Virtual starting balance, in SOL. */
  startingSol: number
  /** USD price of 1 SOL at the start, to convert the balance to USD. */
  solPriceUsd: number
  /** Max fraction of equity in one position, e.g. 0.1 = 10%. */
  maxPositionPct: number
  /** One-way fee+slippage assumption applied per side. */
  feePct: number
}

export interface DemoPosition {
  contract: string
  notionalUsd: number
  entryPriceUsd: number
  exitPriceUsd: number
  grossReturnPct: number
  /** Net of fees on both sides. */
  netReturnPct: number
  pnlUsd: number
  verdict: TradeVerdict
}

export interface DemoPortfolioResult {
  startingSol: number
  startingUsd: number
  endingUsd: number
  endingSol: number
  /** Portfolio return in USD terms. */
  returnPct: number
  positions: DemoPosition[]
  /** Signals skipped because the position cap had no room. */
  skippedNoCapital: number
  /** Signals skipped because no price series resolved them. */
  skippedUnpriceable: number
}

/**
 * Run a demo portfolio over priced trades, chronologically.
 *
 * Sizing follows the signal order: each position takes
 * `min(maxPositionPct × current equity, remaining cash)`. When cash runs out
 * the signal is skipped and counted — silently overspending demo money would
 * make the return meaningless.
 */
export function runDemoPortfolio(
  trades: DemoTrade[],
  config: DemoPortfolioConfig,
): DemoPortfolioResult {
  const startingUsd = config.startingSol * config.solPriceUsd
  let cash = startingUsd
  const positions: DemoPosition[] = []
  let skippedNoCapital = 0
  let skippedUnpriceable = 0

  // One signal triggers at most ONE position: the same contract delivered
  // repeatedly (or replayed at 4 horizons) would otherwise stack MULTIPLE
  // open positions on the same token, overstating both exposure and loss.
  // Prefer the shortest horizon that produced a measurable trade (h1=h4
  // ordering fails when one horizon prices and another does not), because
  // simulating 4 concurrent positions on one token is not what the operator
  // actually executes: they buy once, once.
  const byContract = new Map<string, DemoTrade>()
  for (const t of trades) {
    if (t.returnPct === null || t.entryPriceUsd === null || t.exitPriceUsd === null) {
      // Counted per INPUT trade, before de-duplication: skipping an unpriceable
      // row is invisible otherwise, and the operator needs to know how much of
      // the sample the price feed could not resolve.
      skippedUnpriceable += 1
      continue
    }
    const prev = byContract.get(t.contract)
    if (!prev) {
      byContract.set(t.contract, t)
      continue
    }
    const curH = DEMO_HORIZON_KEYS.findIndex((k) => k === t.horizon)
    const prevH = DEMO_HORIZON_KEYS.findIndex((k) => k === prev.horizon)
    if (curH < prevH) byContract.set(t.contract, t)
  }
  const sortedByTime = [...byContract.values()].sort((a, b) => Date.parse(a.signalAt) - Date.parse(b.signalAt))

  for (const trade of sortedByTime) {
    const equity = cash + positions.reduce((sum, p) => sum + p.notionalUsd * (1 + p.netReturnPct), 0)
    const target = Math.min(equity * config.maxPositionPct, cash)
    if (!(target > 0)) {
      skippedNoCapital += 1
      continue
    }

    // Fees apply on entry AND exit as fractions of notional, so the correct
    // net return multiplies both legs: (1+r)(1-f)^2 - 1. Subtracting 2f is
    // wrong for large r (e.g. +60% gross shows as +59.0% net, not +59%).
    // Guaranteed non-null by the byContract filter above; narrow explicitly so
    // the types do not force a second, weaker null check.
    const gross = trade.returnPct as number
    const entryPrice = trade.entryPriceUsd as number
    const exitPrice = trade.exitPriceUsd as number
    const net = (1 + gross) * Math.pow(1 - config.feePct, 2) - 1
    const pnlUsd = target * net
    cash += pnlUsd

    positions.push({
      contract: trade.contract,
      notionalUsd: target,
      entryPriceUsd: entryPrice,
      exitPriceUsd: exitPrice,
      grossReturnPct: gross * 100,
      netReturnPct: net,
      pnlUsd,
      verdict: trade.verdict,
    })
  }

  const endingUsd = cash
  return {
    startingSol: config.startingSol,
    startingUsd,
    endingUsd,
    endingSol: config.solPriceUsd > 0 ? endingUsd / config.solPriceUsd : 0,
    returnPct: startingUsd > 0 ? ((endingUsd - startingUsd) / startingUsd) * 100 : 0,
    positions,
    skippedNoCapital,
    skippedUnpriceable,
  }
}
