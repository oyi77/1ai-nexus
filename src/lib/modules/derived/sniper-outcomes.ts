// ─────────────────────────────────────────────────────────────
// Meme Sniper — signal outcome tracking (TAHAP 4).
//
// The pipeline ends at "delivered". Nothing recorded what the market did
// afterwards, so the operator could never say whether a delivered signal
// made money, and the tier/confidence logic had no ground truth to learn
// from. This module closes that loop.
//
// Design rules, inherited from the evaluator:
//   • A signal is only scored once it has a real forward price. No price =
//     PENDING, never a fabricated 0.
//   • The window is fixed at delivery time (not "now minus 24h") so a signal
//     scored late still measures the SAME horizon as one scored early.
//   • Outcomes are append-only per signal id: re-running a sweep updates the
//     record in place, it never double-counts a win.
//
// I/O is isolated: `readOutcomes`/`writeOutcomes` are the only file access,
// everything else is pure and unit-testable.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type OutcomeVerdict = 'PENDING' | 'TARGET' | 'STOPPED' | 'FLAT' | 'UNPRICEABLE'

export interface SignalOutcome {
  contract: string
  ticker: string
  /** Tier at delivery — the thing being scored. */
  tier: string
  /** ISO of delivery (the evaluation that pushed it). */
  deliveredAt: string
  /** Entry market cap at delivery. null = unproven, outcome stays PENDING. */
  entryMarketCapUsd: number | null
  /** Horizon in hours this signal is measured over. */
  horizonHours: number
  /** The bar at/after which the outcome is judged. null until sweepable. */
  dueAt: string | null
  /** Market cap observed at/after the due time. null = not yet observed. */
  exitMarketCapUsd: number | null
  /** (exit-entry)/entry as a fraction. null when either side is unproven. */
  returnPct: number | null
  verdict: OutcomeVerdict
  /** When the verdict was last computed. */
  scoredAt: string | null
}

export interface OutcomeLog {
  version: 1
  signals: SignalOutcome[]
  updatedAt: string | null
}

/**
 * Target/stop as a fraction of the entry market cap. A meme sniper signal
 * that doubles is a target; one that halves is a stop. These are the operator
 * -visible success criteria, kept here so the score means one thing.
 */
export const OUTCOME_DEFAULTS = {
  horizonHours: 24,
  targetReturn: 1.0, // +100%
  stopReturn: -0.5, // -50%
} as const

export interface OutcomeConfig {
  horizonHours: number
  targetReturn: number
  stopReturn: number
}

function outcomePath(): string {
  return process.env.SNIPER_OUTCOMES_PATH ?? join(process.cwd(), 'data', 'sniper-outcomes.json')
}

export function emptyOutcomeLog(): OutcomeLog {
  return { version: 1, signals: [], updatedAt: null }
}

/** Read the log; a missing/corrupt file reads as empty (never throws). */
export function readOutcomes(): OutcomeLog {
  const path = outcomePath()
  if (!existsSync(path)) return emptyOutcomeLog()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<OutcomeLog>
    if (!Array.isArray(raw.signals)) return emptyOutcomeLog()
    return { version: 1, signals: raw.signals, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null }
  } catch {
    return emptyOutcomeLog()
  }
}

export function writeOutcomes(log: OutcomeLog): OutcomeLog {
  const next: OutcomeLog = { version: 1, signals: log.signals, updatedAt: new Date().toISOString() }
  const path = outcomePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2))
  return next
}

export function registerDelivered(
  log: OutcomeLog,
  signal: { contract: string; ticker: string; tier: string; entryMarketCapUsd: number | null; deliveredAt: string },
  config: OutcomeConfig = OUTCOME_DEFAULTS,
): OutcomeLog {
  if (log.signals.some((s) => s.contract === signal.contract)) return log

  const entryMs = Date.parse(signal.deliveredAt)
  const dueAt =
    Number.isFinite(entryMs) && signal.entryMarketCapUsd !== null
      ? new Date(entryMs + config.horizonHours * 3_600_000).toISOString()
      : null

  return {
    ...log,
    signals: [
      ...log.signals,
      {
        contract: signal.contract,
        ticker: signal.ticker,
        tier: signal.tier,
        deliveredAt: signal.deliveredAt,
        entryMarketCapUsd: signal.entryMarketCapUsd,
        horizonHours: config.horizonHours,
        dueAt,
        exitMarketCapUsd: null,
        returnPct: null,
        // A signal with no proven entry is never watchable — it can never be
        // scored, and saying PENDING forever is the honest answer.
        verdict: signal.entryMarketCapUsd === null ? 'UNPRICEABLE' : 'PENDING',
        scoredAt: null,
      },
    ],
  }
}

/**
 * Score one signal against a price observation.
 *
 * `observedAt` is the time the price belongs to; the outcome is only judged
 * once `observedAt >= dueAt`, so a 24h horizon is measured over 24h.
 * Returning the SAME log entry when nothing changed keeps sweeps idempotent.
 */
export function scoreSignal(
  signal: SignalOutcome,
  observation: { marketCapUsd: number | null; observedAt: string } | null,
  now: Date = new Date(),
  config: OutcomeConfig = OUTCOME_DEFAULTS,
): SignalOutcome {
  if (signal.verdict === 'UNPRICEABLE') return signal
  if (signal.entryMarketCapUsd === null || signal.dueAt === null) return signal
  if (!observation || observation.marketCapUsd === null) return signal

  const dueMs = Date.parse(signal.dueAt)
  const obsMs = Date.parse(observation.observedAt)
  if (!Number.isFinite(dueMs) || !Number.isFinite(obsMs) || obsMs < dueMs) return signal

  const entry = signal.entryMarketCapUsd
  if (entry <= 0) return { ...signal, verdict: 'UNPRICEABLE', scoredAt: now.toISOString() }

  const ret = (observation.marketCapUsd - entry) / entry
  const verdict: OutcomeVerdict =
    ret >= config.targetReturn ? 'TARGET' : ret <= config.stopReturn ? 'STOPPED' : 'FLAT'

  return {
    ...signal,
    exitMarketCapUsd: observation.marketCapUsd,
    returnPct: ret,
    verdict,
    scoredAt: now.toISOString(),
  }
}

export interface OutcomeStats {
  /** Signals with a final verdict. */
  scored: number
  targets: number
  stopped: number
  flat: number
  pending: number
  unpriceable: number
  /** targets / scored, as a percentage. null when nothing is scored yet. */
  hitRatePct: number | null
  /** Mean return over scored signals. null when nothing is scored. */
  avgReturnPct: number | null
}

/**
 * Aggregate the log. UNPRICEABLE and PENDING are reported separately and
 * never folded into the hit rate — a signal that was never measurable is not
 * a miss, and counting it as one would understate the engine.
 */
export function summariseOutcomes(signals: SignalOutcome[]): OutcomeStats {
  const scored = signals.filter((s) => s.verdict === 'TARGET' || s.verdict === 'STOPPED' || s.verdict === 'FLAT')
  const targets = scored.filter((s) => s.verdict === 'TARGET').length
  const stopped = scored.filter((s) => s.verdict === 'STOPPED').length
  const flat = scored.filter((s) => s.verdict === 'FLAT').length
  const returns = scored.map((s) => s.returnPct).filter((r): r is number => r !== null)

  return {
    scored: scored.length,
    targets,
    stopped,
    flat,
    pending: signals.filter((s) => s.verdict === 'PENDING').length,
    unpriceable: signals.filter((s) => s.verdict === 'UNPRICEABLE').length,
    hitRatePct: scored.length > 0 ? (targets / scored.length) * 100 : null,
    avgReturnPct: returns.length > 0 ? (returns.reduce((a, b) => a + b, 0) / returns.length) * 100 : null,
  }
}

/**
 * Per-tier performance — the number that tells the operator which tier to
 * trust. A tier with no scored signals reports null hit rate, NOT 0%.
 */
export function summariseByTier(signals: SignalOutcome[]): Record<string, OutcomeStats> {
  const tiers = [...new Set(signals.map((s) => s.tier))]
  return Object.fromEntries(tiers.map((t) => [t, summariseOutcomes(signals.filter((s) => s.tier === t))]))
}

/**
 * Price observation for the sweep: the market cap the pipeline currently
 * believes for a contract, and the time that belief belongs to.
 */
export interface PriceObservation {
  contract: string
  marketCapUsd: number | null
  observedAt: string
}

/**
 * Register every delivered decision in this scan pass. Decisions that did
 * not deliver are skipped — only a push the operator could act on enters
 * the log. Pure: returns the extended log, the caller persists it.
 */
export function registerDeliveries(
  log: OutcomeLog,
  decisions: Array<{
    contract: string
    ticker: string
    tier: string
    delivered: boolean
    market?: { marketCapUsd?: number | null } | null
  }>,
  deliveredAt: string,
  config: OutcomeConfig = OUTCOME_DEFAULTS,
): OutcomeLog {
  let next = log
  for (const d of decisions) {
    if (!d.delivered) continue
    next = registerDelivered(
      next,
      {
        contract: d.contract,
        ticker: d.ticker,
        tier: d.tier,
        entryMarketCapUsd: d.market?.marketCapUsd ?? null,
        deliveredAt,
      },
      config,
    )
  }
  return next
}

/**
 * Score every still-open signal that has a fresh observation.
 *
 * Observations come from the current scan's market snapshots. A signal whose
 * contract fell off discovery has no observation and stays PENDING — never
 * auto-closed as a miss, because absence of a price is not evidence the
 * trade failed.
 *
 * Pure; returns the rescored log, the caller persists it.
 */
export function sweepOutcomes(
  log: OutcomeLog,
  prices: Map<string, PriceObservation> | PriceObservation[],
  config: OutcomeConfig = OUTCOME_DEFAULTS,
): OutcomeLog {
  const byContract = Array.isArray(prices) ? new Map(prices.map((p) => [p.contract, p])) : prices
  return {
    ...log,
    signals: log.signals.map((s) => {
      if (s.verdict !== 'PENDING') return s
      const obs = byContract.get(s.contract)
      if (!obs) return s
      const at = new Date(obs.observedAt)
      return scoreSignal(s, { marketCapUsd: obs.marketCapUsd, observedAt: obs.observedAt }, at, config)
    }),
  }
}
