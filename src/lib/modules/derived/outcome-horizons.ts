// ─────────────────────────────────────────────────────────────
// Meme Sniper — multi-horizon outcome metrics (pure analytics).
//
// sniper-outcomes.ts closes the loop at ONE horizon (24h). The operator
// also wants the 1h / 4h / 24h / 7d shape of the same delivered signals,
// plus buckets by wallet quality, entry market cap and risk — without
// changing what gets delivered.
//
// Design rules, inherited from the outcome engine:
//   • A horizon is only scored once an observation exists at/after its due
//     time. No observation = PENDING, never a fabricated 0.
//   • Each horizon is a fresh forward-return verdict against the SAME
//     +100% / -50% bands — a signal that doubled by 1h is a TARGET at 1h
//     even if the 24h verdict later differs.
//   • No I/O lives here. Callers supply signal records and observations.
// ─────────────────────────────────────────────────────────────

import {
  OUTCOME_DEFAULTS,
  scoreSignal,
  summariseOutcomes,
  type OutcomeConfig,
  type OutcomeStats,
  type OutcomeVerdict,
  type SignalOutcome,
} from './sniper-outcomes'

const HOUR_MS = 3_600_000

/** Horizons measured over every delivered signal, in hours. */
export const OUTCOME_HORIZONS = {
  h1: 1,
  h4: 4,
  h24: 24,
  d7: 7 * 24,
} as const

export type HorizonKey = keyof typeof OUTCOME_HORIZONS

/** Fixed iteration order for logs, summaries and tests. */
export const HORIZON_KEYS = Object.keys(OUTCOME_HORIZONS) as HorizonKey[]

/** One forward price observation (unit-price proxy, same as the engine). */
export interface HorizonObservation {
  marketCapUsd: number | null
  observedAt: string
}

/** Per-horizon projection of one signal. PENDING means not yet due. */
export interface HorizonResult {
  returnPct: number | null
  verdict: 'TARGET' | 'STOPPED' | 'FLAT' | 'PENDING' | null
  dueAt: string | null
}

function dueAtFor(deliveredAt: string, horizonHours: number): string | null {
  const deliveredMs = Date.parse(deliveredAt)
  return Number.isFinite(deliveredMs) ? new Date(deliveredMs + horizonHours * HOUR_MS).toISOString() : null
}

/** Pick the observation closest to `dueMs` that is at/after it. */
function pickObservationAtOrAfter(
  observations: readonly HorizonObservation[],
  dueMs: number,
): HorizonObservation | null {
  const eligible = observations.filter((o) => {
    const t = Date.parse(o.observedAt)
    return Number.isFinite(t) && t >= dueMs
  })
  if (eligible.length === 0) return null
  return eligible.reduce((best, o) => {
    const bestDist = Math.abs(Date.parse(best.observedAt) - dueMs)
    const dist = Math.abs(Date.parse(o.observedAt) - dueMs)
    return dist < bestDist ? o : best
  })
}

/**
 * Score one signal over an explicit horizon. Forward-looking only: if the
 * observation is before `deliveredAt + horizonHours`, the signal is returned
 * as-is (not yet due). Once due, the return is computed against the entry and
 * classified with `scoreSignal`'s threshold semantics — the +100% / -50%
 * bands are imported, never duplicated.
 */
export function scoreSignalAtHorizon(
  signal: SignalOutcome,
  observation: { marketCapUsd: number | null; observedAt: string },
  horizonHours: number,
  now: Date = new Date(),
  config: OutcomeConfig = OUTCOME_DEFAULTS,
): SignalOutcome {
  return scoreSignal(
    { ...signal, horizonHours, dueAt: dueAtFor(signal.deliveredAt, horizonHours) },
    observation,
    now,
    config,
  )
}

/**
 * Project one signal onto every horizon. For each horizon the observation
 * closest to (and at/after) the due time wins; with none, the horizon stays
 * PENDING with a null verdict. Pure and deterministic.
 */
export function horizonOutcomes(
  signal: SignalOutcome,
  observations: HorizonObservation[],
  now: Date = new Date(),
  config: OutcomeConfig = OUTCOME_DEFAULTS,
): Record<HorizonKey, HorizonResult> {
  const deliveredMs = Date.parse(signal.deliveredAt)
  const out = {} as Record<HorizonKey, HorizonResult>

  for (const key of HORIZON_KEYS) {
    const hours = OUTCOME_HORIZONS[key]
    const dueAt = dueAtFor(signal.deliveredAt, hours)
    const obs = Number.isFinite(deliveredMs)
      ? pickObservationAtOrAfter(observations, deliveredMs + hours * HOUR_MS)
      : null

    if (!obs) {
      out[key] = { returnPct: null, verdict: 'PENDING', dueAt }
      continue
    }

    const scored = scoreSignalAtHorizon(signal, obs, hours, now, config)
    if (scored.verdict === 'PENDING') {
      // No usable forward price (or no proven entry) at this horizon.
      out[key] = { returnPct: null, verdict: 'PENDING', dueAt }
    } else if (scored.verdict === 'UNPRICEABLE') {
      out[key] = { returnPct: null, verdict: null, dueAt }
    } else {
      out[key] = { returnPct: scored.returnPct, verdict: scored.verdict, dueAt }
    }
  }

  return out
}

/**
 * Project every signal onto every horizon — the explicit, typed feed for
 * `summariseHorizons`. Signals without an observation at a horizon stay
 * PENDING there (the honest answer, not a miss).
 */
export function projectHorizonSignals(
  signals: SignalOutcome[],
  observationsByContract: ReadonlyMap<string, readonly HorizonObservation[]>,
  now: Date = new Date(),
  config: OutcomeConfig = OUTCOME_DEFAULTS,
): Record<HorizonKey, SignalOutcome[]> {
  const out = {} as Record<HorizonKey, SignalOutcome[]>

  for (const key of HORIZON_KEYS) {
    const hours = OUTCOME_HORIZONS[key]
    out[key] = signals.map((signal) => {
      const deliveredMs = Date.parse(signal.deliveredAt)
      const due = Number.isFinite(deliveredMs) ? deliveredMs + hours * HOUR_MS : Number.NaN
      const obs = Number.isFinite(due)
        ? pickObservationAtOrAfter(observationsByContract.get(signal.contract) ?? [], due)
        : null
      if (!obs) {
        return { ...signal, horizonHours: hours, dueAt: dueAtFor(signal.deliveredAt, hours) }
      }
      return scoreSignalAtHorizon(signal, obs, hours, now, config)
    })
  }

  return out
}

/**
 * Aggregate per-horizon projections with the existing outcome summariser —
 * same `OutcomeStats` shape, same null-vs-0% discipline.
 */
export function summariseHorizons(
  projected: Record<HorizonKey, SignalOutcome[]>,
): Record<HorizonKey, OutcomeStats> {
  return Object.fromEntries(
    HORIZON_KEYS.map((key) => [key, summariseOutcomes(projected[key])]),
  ) as Record<HorizonKey, OutcomeStats>
}

// ─── Grouping buckets ────────────────────────────────────────

export type WalletQuality = 'WHALE' | 'SMART' | 'MIXED' | 'NONE'

export const WALLET_QUALITY_KEYS = ['WHALE', 'SMART', 'MIXED', 'NONE'] as const satisfies readonly WalletQuality[]

export const MC_BUCKET_KEYS = ['<100k', '100k-1M', '>1M', 'unknown'] as const

export type RiskBucket = 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN'

export const RISK_BUCKET_KEYS = ['HIGH', 'MED', 'LOW', 'UNKNOWN'] as const satisfies readonly RiskBucket[]

/** Normalise a smart-money `strongest` label into the four-bucket wallet quality. */
export function walletQualityFromStrongest(strongest: string | null | undefined): WalletQuality {
  if (strongest === 'WHALE_AND_SMART_MONEY') return 'MIXED'
  if (strongest === 'WHALE') return 'WHALE'
  if (strongest === 'QUALIFIED_SMART_MONEY') return 'SMART'
  return 'NONE'
}

function groupBy(
  signals: SignalOutcome[],
  keyFor: (signal: SignalOutcome) => string,
  keys: readonly string[],
): Record<string, OutcomeStats> {
  const buckets: Record<string, SignalOutcome[]> = Object.fromEntries(keys.map((key) => [key, []]))
  for (const signal of signals) buckets[keyFor(signal)].push(signal)
  return Object.fromEntries(keys.map((key) => [key, summariseOutcomes(buckets[key])]))
}

/** Per-wallet-quality performance; a bucket with no scored signals is null, not 0%. */
export function groupByWalletQuality(
  signals: SignalOutcome[],
  qualityByContract: ReadonlyMap<string, WalletQuality>,
): Record<string, OutcomeStats> {
  return groupBy(signals, (s) => qualityByContract.get(s.contract) ?? 'NONE', WALLET_QUALITY_KEYS)
}

/** Entry market-cap bucket for one contract. */
export function mcBucketKey(mc: number | null | undefined): string {
  if (mc === null || mc === undefined || !Number.isFinite(mc) || mc < 0) return 'unknown'
  if (mc < 100_000) return '<100k'
  if (mc <= 1_000_000) return '100k-1M'
  return '>1M'
}

/** Per-entry-market-cap-bucket performance. */
export function groupByMcBucket(
  signals: SignalOutcome[],
  mcByContract: ReadonlyMap<string, number | null>,
): Record<string, OutcomeStats> {
  return groupBy(signals, (s) => mcBucketKey(mcByContract.get(s.contract) ?? null), MC_BUCKET_KEYS)
}

/** Per-risk-bucket performance; missing/unknown risk falls into UNKNOWN. */
export function groupByRisk(
  signals: SignalOutcome[],
  riskByContract: ReadonlyMap<string, RiskBucket>,
): Record<string, OutcomeStats> {
  return groupBy(signals, (s) => riskByContract.get(s.contract) ?? 'UNKNOWN', RISK_BUCKET_KEYS)
}

/** Re-exported so grouping callers stay on the shared verdict vocabulary. */
export type { OutcomeVerdict }
