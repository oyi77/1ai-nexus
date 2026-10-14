// ─────────────────────────────────────────────────────────────
// Meme Sniper — paper-buy simulator (TAHAP 5, shadow analytics).
//
// Answers "had I bought $X at signal time, what would my PnL be at each
// horizon?" WITHOUT any on-chain execution. This is a pure analytics layer
// on top of the outcome log: every paper position is derived from a signal
// the pipeline actually DELIVERED, so the sim can never invent a trade.
//
// Design rules, inherited from the outcome engine:
//   • A position is only scored from a real forward observation the outcome
//     pipeline already recorded. No observation = PENDING, never a
//     fabricated 0 — an unproven position is OPEN, not a loss.
//   • The per-horizon verdict comes from `outcome-horizons.ts`'s existing
//     projection (`scoreSignalAtHorizon`) — the +100% / -50% bands live in
//     exactly one place.
//   • CURRENT LIMITATION (honest by design): the outcome log stores ONE
//     exit price per signal (its own horizon, 24h by default). Until the
//     price observer persists per-horizon observations, only that horizon
//     carries data and the others stay PENDING. Projecting the 24h price
//     onto the 1h/4h/7d bars would fabricate history, so it is not done.
//
// Pure: zero I/O, zero env reads, deterministic given its inputs.
// ─────────────────────────────────────────────────────────────

import {
  OUTCOME_HORIZONS,
  HORIZON_KEYS,
  scoreSignalAtHorizon,
  type HorizonKey,
} from './outcome-horizons'
import { escapeSignalHtml } from './signal-tier'
import type { SignalOutcome } from './sniper-outcomes'

/** Per-horizon paper result for one position. null = PENDING at that bar. */
export interface PaperHorizon {
  exitMarketCapUsd: number | null
  returnPct: number | null
  pnlUsd: number | null
  verdict: 'TARGET' | 'STOPPED' | 'FLAT' | 'PENDING' | null
}

/** One paper trade: fixed `notionalUsd` staked at delivery time. */
export interface PaperPosition {
  contract: string
  ticker: string
  tier: string
  deliveredAt: string
  entryMarketCapUsd: number | null
  notionalUsd: number
  horizons: Record<HorizonKey, PaperHorizon>
}

/** Portfolio aggregate over paper positions. Never fabricates: no closed
 * position ⇒ null rates, not 0%. */
export interface PaperSummary {
  totalNotionalUsd: number
  openPositions: number
  closedPositions: number
  wins: number
  losses: number
  flat: number
  totalPnlUsd: number
  winRatePct: number | null
  avgReturnPct: number | null
  best: PaperPosition | null
  worst: PaperPosition | null
}

const EMPTY_HORIZON: PaperHorizon = {
  exitMarketCapUsd: null,
  returnPct: null,
  pnlUsd: null,
  verdict: null,
}

/** The horizon key whose hour count matches the signal's logged window. */
function horizonKeyFor(horizonHours: number): HorizonKey | null {
  for (const key of HORIZON_KEYS) {
    if (OUTCOME_HORIZONS[key] === horizonHours) return key
  }
  return null
}

/** Format a fraction as a signed percentage, or 'n/a' when unmeasured.
 * Guards NaN/Infinity so the operator never sees them in a Telegram block. */
function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return `${(value * 100).toFixed(1)}%`
}

/** Format USD with explicit sign and cents. Guards NaN/Infinity to $0.00. */
function fmtUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0
  return `${safe < 0 ? '-' : '+'}$${Math.abs(safe).toFixed(2)}`
}

/** Keep the block compact even for long memecoin tickers. */
function short(s: string): string {
  return s.length > 16 ? `${s.slice(0, 15)}…` : s
}

/**
 * Build paper positions from the outcome log. Every delivered signal gets a
 * position at the fixed notional; only the horizon the log actually scored
 * (via `scoreSignalAtHorizon` — the shared threshold logic) carries PnL.
 * PENDING / UNPRICEABLE / unproven-entry signals become OPEN positions with
 * null PnL everywhere.
 */
export function buildPaperPositions(signals: SignalOutcome[], notionalUsd: number): PaperPosition[] {
  return signals.map((signal) => {
    const horizons: Record<HorizonKey, PaperHorizon> = {
      h1: { ...EMPTY_HORIZON },
      h4: { ...EMPTY_HORIZON },
      h24: { ...EMPTY_HORIZON },
      d7: { ...EMPTY_HORIZON },
    }

    const key = horizonKeyFor(signal.horizonHours)
    const observedAt = signal.scoredAt ?? signal.dueAt
    // The verdict set the engine actually measured. UNPRICEABLE is terminal
    // but unmeasurable — such a signal stays open, never counts as a loss.
    const scored =
      signal.verdict === 'TARGET' || signal.verdict === 'STOPPED' || signal.verdict === 'FLAT'
    if (key !== null && scored && signal.exitMarketCapUsd !== null && observedAt !== null) {
      // Re-project the logged exit observation at the signal's own horizon
      // through the shared scorer — the verdict bands are never re-derived.
      const projected = scoreSignalAtHorizon(
        signal,
        { marketCapUsd: signal.exitMarketCapUsd, observedAt },
        signal.horizonHours,
      )
      const ret = projected.returnPct
      const verdict = projected.verdict
      horizons[key] = {
        exitMarketCapUsd: signal.exitMarketCapUsd,
        returnPct: ret,
        pnlUsd: ret === null ? null : notionalUsd * ret,
        // An already-scored verdict can only re-project to TARGET/STOPPED/
        // FLAT (UNPRICEABLE is returned untouched, and is filtered above).
        verdict: verdict === 'TARGET' || verdict === 'STOPPED' || verdict === 'FLAT' ? verdict : null,
      }
    }

    return {
      contract: signal.contract,
      ticker: signal.ticker,
      tier: signal.tier,
      deliveredAt: signal.deliveredAt,
      entryMarketCapUsd: signal.entryMarketCapUsd,
      notionalUsd,
      horizons,
    }
  })
}

/** The first horizon a position actually scored, in fixed HORIZON_KEYS order. */
export function scoredHorizon(position: PaperPosition): { key: HorizonKey; horizon: PaperHorizon } | null {
  for (const key of HORIZON_KEYS) {
    const horizon = position.horizons[key]
    if (horizon.verdict !== null && horizon.returnPct !== null && horizon.pnlUsd !== null) {
      return { key, horizon }
    }
  }
  return null
}

/**
 * Aggregate the paper book. Wins/losses/flat count closed positions by their
 * scored verdict; positions without forward data are openPositions, never
 * losses. totalPnlUsd sums realized PnL per position (currently at most one
 * scored horizon per position — see the module-header limitation).
 */
export function summarisePaperPositions(positions: PaperPosition[]): PaperSummary {
  let wins = 0
  let losses = 0
  let flat = 0
  let closed = 0
  let totalPnlUsd = 0
  let returnSum = 0
  let best: PaperPosition | null = null
  let worst: PaperPosition | null = null
  let bestReturn = Number.NEGATIVE_INFINITY
  let worstReturn = Number.POSITIVE_INFINITY

  for (const position of positions) {
    const scored = scoredHorizon(position)
    if (scored === null) continue
    closed += 1
    totalPnlUsd += scored.horizon.pnlUsd ?? 0
    returnSum += scored.horizon.returnPct ?? 0
    if (scored.horizon.verdict === 'TARGET') wins += 1
    else if (scored.horizon.verdict === 'STOPPED') losses += 1
    else flat += 1

    if (scored.horizon.returnPct !== null && scored.horizon.returnPct > bestReturn) {
      bestReturn = scored.horizon.returnPct
      best = position
    }
    if (scored.horizon.returnPct !== null && scored.horizon.returnPct < worstReturn) {
      worstReturn = scored.horizon.returnPct
      worst = position
    }
  }

  const denom = wins + losses
  return {
    totalNotionalUsd: positions.length > 0 ? positions[0].notionalUsd * positions.length : 0,
    openPositions: positions.length - closed,
    closedPositions: closed,
    wins,
    losses,
    flat,
    totalPnlUsd,
    winRatePct: denom > 0 ? (wins / denom) * 100 : null,
    avgReturnPct: closed > 0 ? returnSum / closed : null,
    best,
    worst,
  }
}

/** Compact HTML block for the operator's review chat. Under 2000 chars.
 * Dynamic text (tickers, titles) goes through escapeSignalHtml — the
 * transport sends parse_mode=HTML, so raw `<` in data must never open an
 * entity. */
export function renderPaperSummary(summary: PaperSummary, opts?: { title?: string }): string {
  const title = opts?.title ?? 'PAPER TRADING SUMMARY'
  const lines: string[] = []
  lines.push(`📈 <b>${escapeSignalHtml(title)}</b>`)
  const notional = Number.isFinite(summary.totalNotionalUsd) ? summary.totalNotionalUsd : 0
  lines.push(
    `Notional: $${notional.toFixed(2)} · ` +
      `Open: ${summary.openPositions} · Closed: ${summary.closedPositions} ` +
      `(${summary.wins}W / ${summary.losses}L / ${summary.flat}F)`,
  )
  lines.push(
    `Win rate: ${fmtPct(summary.winRatePct === null ? null : summary.winRatePct / 100)} · ` +
      `Total PnL: ${fmtUsd(summary.totalPnlUsd)} · Avg return: ${fmtPct(summary.avgReturnPct)}`,
  )
  const best = summary.best
  if (best !== null) {
    const scored = scoredHorizon(best)
    lines.push(`🏆 Best: ${escapeSignalHtml(short(best.ticker))} ${fmtPct(scored?.horizon.returnPct ?? null)}`)
  }
  const worst = summary.worst
  if (worst !== null) {
    const scored = scoredHorizon(worst)
    lines.push(`💀 Worst: ${escapeSignalHtml(short(worst.ticker))} ${fmtPct(scored?.horizon.returnPct ?? null)}`)
  }
  lines.push('⚠️ <i>paper simulation — no on-chain execution, not financial advice</i>')
  return lines.join('\n')
}
