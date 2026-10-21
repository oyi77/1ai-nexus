/**
 * Forward test (paper trading) — pure logic.
 *
 * Differs from the backtest in one essential way: the backtest may look at
 * bars that already offered a target/stop touch, while a forward test decides
 * at the horizon boundary and takes whatever price is there. That makes it
 * the honest forward expectation: "if I had staked 10 SOL spread over live
 * signals, what would the balance be?"
 *
 * No network, no clock, no disk: the runner feeds prices in and writes state.
 */
import type { DemoBacktestConfig, DeliveredSignal, DemoTrade, TradeVerdict } from './signal-backtest'
import { DEMO_BACKTEST_DEFAULTS, DEMO_HORIZONS, DEMO_HORIZON_KEYS } from './signal-backtest'

/** One open paper position funded from the demo balance. */
export interface ForwardPosition {
  contract: string
  /** ISO timestamp the delivered signal was observed. */
  openedAt: string
  horizon: 'h1' | 'h4' | 'h24' | 'd7'
  /** When the position must be marked. ISO. */
  dueAt: string
  notionalUsd: number
  entryPriceUsd: number
}

/** A position that reached its horizon and was priced. */
export interface ForwardClose {
  contract: string
  openedAt: string
  dueAt: string
  horizon: ForwardPosition['horizon']
  notionalUsd: number
  entryPriceUsd: number
  exitPriceUsd: number
  returnPct: number
  pnlUsd: number
  verdict: TradeVerdict
}

export interface ForwardState {
  /** Demo equity in USD. Virtual only — no orders are ever placed. */
  cashUsd: number
  startUsd: number
  /** Contracts already opened or closed; one position per contract. */
  seenContracts: string[]
  open: ForwardPosition[]
  closed: ForwardClose[]
}

export interface ForwardConfig {
  startingSol: number
  solPriceUsd: number
  /** Fraction of current equity staked per signal. */
  maxPositionPct: number
  /** Trading fee as a fraction of notional, charged on entry and exit. */
  feePct: number
  /** Round-trip verdict thresholds (shared with the backtest). */
  verdicts: DemoBacktestConfig
}

export const FORWARD_DEFAULTS: Omit<ForwardConfig, 'startingSol' | 'solPriceUsd'> = {
  maxPositionPct: 0.1,
  feePct: 0.005,
  verdicts: DEMO_BACKTEST_DEFAULTS,
}

export function horizonDueMs(openedAtMs: number, horizon: ForwardPosition['horizon']): number {
  return openedAtMs + DEMO_HORIZONS[horizon] * 3_600_000
}

export function emptyForwardState(startingSol: number, solPriceUsd: number): ForwardState {
  const startUsd = startingSol * solPriceUsd
  return { cashUsd: startUsd, startUsd, seenContracts: [], open: [], closed: [] }
}

/**
 * Open a paper position for `signal` at `entryPriceUsd`.
 *
 * Returns `null` when the contract was already traded (one position per
 * contract prevents the same token being re-bought on every re-alert) or when
 * there is no cash left. The caller distinguishes those two cases itself.
 */
export function openForwardPosition(
  state: ForwardState,
  signal: DeliveredSignal,
  entryPriceUsd: number,
  horizon: ForwardPosition['horizon'],
  cfg: ForwardConfig,
): ForwardPosition | null {
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return null
  if (state.seenContracts.includes(signal.contract)) return null
  const notionalUsd = Math.min(state.cashUsd, state.cashUsd * cfg.maxPositionPct)
  if (!(notionalUsd > 0)) return null
  const openedAtMs = Date.parse(signal.at)
  if (!Number.isFinite(openedAtMs)) return null
  return {
    contract: signal.contract,
    openedAt: signal.at,
    horizon,
    dueAt: new Date(horizonDueMs(openedAtMs, horizon)).toISOString(),
    notionalUsd,
    entryPriceUsd,
  }
}

/** Classify a closed forward trade: target/stop on the realised move, else flat. */
export function classifyForwardExit(
  returnPct: number,
  cfg: DemoBacktestConfig = DEMO_BACKTEST_DEFAULTS,
): TradeVerdict {
  if (returnPct >= cfg.targetPct) return 'TARGET'
  if (returnPct <= -cfg.stopPct) return 'STOPPED'
  return 'FLAT'
}

/** Close an open position at its horizon price, charging fees on both legs. */
export function closeForwardPosition(
  position: ForwardPosition,
  exitPriceUsd: number,
  cfg: ForwardConfig,
): ForwardClose {
  const gross = exitPriceUsd / position.entryPriceUsd
  // Two legs of fees: entry and exit.
  const net = gross * (1 - cfg.feePct) * (1 - cfg.feePct)
  const returnPct = net - 1
  const pnlUsd = position.notionalUsd * returnPct
  return {
    contract: position.contract,
    openedAt: position.openedAt,
    dueAt: position.dueAt,
    horizon: position.horizon,
    notionalUsd: position.notionalUsd,
    entryPriceUsd: position.entryPriceUsd,
    exitPriceUsd,
    returnPct,
    pnlUsd,
    verdict: classifyForwardExit(returnPct, cfg.verdicts),
  }
}

/** Total equity: realised cash plus the notional still tied up in open positions. */
export function forwardEquityUsd(state: ForwardState): number {
  const openNotional = state.open.reduce((sum, p) => sum + p.notionalUsd, 0)
  return state.cashUsd + openNotional
}

/** Positions whose horizon has elapsed at `nowMs`. */
export function duePositions(state: ForwardState, nowMs: number): ForwardPosition[] {
  return state.open.filter((p) => Date.parse(p.dueAt) <= nowMs)
}

export interface ForwardSummary {
  startingUsd: number
  equityUsd: number
  returnPct: number
  open: number
  closed: number
  wins: number
  losses: number
  flats: number
  winRatePct: number | null
  avgReturnPct: number | null
  medianReturnPct: number | null
  bestReturnPct: number | null
  worstReturnPct: number | null
}

/** Aggregate closed forward trades. Never invents a rate from zero trades. */
export function summariseForward(state: ForwardState): ForwardSummary {
  const closed = state.closed
  const returns = closed.map((c) => c.returnPct).sort((a, b) => a - b)
  const wins = closed.filter((c) => c.verdict === 'TARGET').length
  const losses = closed.filter((c) => c.verdict === 'STOPPED').length
  const flats = closed.filter((c) => c.verdict === 'FLAT').length
  const median = returns.length === 0 ? null : returns[Math.floor((returns.length - 1) / 2)]
  const equityUsd = forwardEquityUsd(state)
  return {
    startingUsd: state.startUsd,
    equityUsd,
    returnPct: state.startUsd > 0 ? equityUsd / state.startUsd - 1 : 0,
    open: state.open.length,
    closed: closed.length,
    wins,
    losses,
    flats,
    winRatePct: closed.length === 0 ? null : (wins / closed.length) * 100,
    avgReturnPct: returns.length === 0 ? null : (returns.reduce((a, b) => a + b, 0) / returns.length) * 100,
    medianReturnPct: median === null ? null : median * 100,
    bestReturnPct: returns.length === 0 ? null : returns[returns.length - 1] * 100,
    worstReturnPct: returns.length === 0 ? null : returns[0] * 100,
  }
}

/** Trades in the shape the backtest's summary already understands. */
export function forwardTrades(state: ForwardState): DemoTrade[] {
  return state.closed.map((c) => ({
    contract: c.contract,
    signalAt: c.openedAt,
    horizon: c.horizon,
    entryPriceUsd: c.entryPriceUsd,
    exitPriceUsd: c.exitPriceUsd,
    returnPct: c.returnPct,
    verdict: c.verdict,
  }))
}

/**
 * Signals that have not been traded yet, capped by `limit`.
 *
 * Newest first: a forward test must mirror what the strategy selects TODAY,
 * and today's candidates are the freshest ones. Oldest-first would spend the
 * whole run on tokens the pipeline stopped recommending days ago.
 */
export function untradedSignals(
  signals: DeliveredSignal[],
  state: ForwardState,
  limit: number,
  maxAgeDays = 30,
): DeliveredSignal[] {
  const seen = new Set(state.seenContracts)
  const cutoff = Date.now() - maxAgeDays * 86_400_000
  return [...signals]
    .filter((s) => !seen.has(s.contract) && Date.parse(s.at) >= cutoff)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(0, limit))
}

export { DEMO_HORIZON_KEYS, DEMO_HORIZONS }
