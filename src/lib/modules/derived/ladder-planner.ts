// ─────────────────────────────────────────────────────────────
// Ladder planner — the operator's position-sizing rule, as code.
//
// Operator's rule (verbatim intent):
//   · never buy the whole position at one market cap
//   · split into 2–3 tranches, each with a REASON (break / retest /
//     reclaim), never "just buy because it dropped"
//   · ONE stop loss for the whole position
//   · never add below the stop
//   · size from the stop first: risk budget ÷ stop distance, then split
//
// So the ladder is derived from RISK, not from a fixed USD amount:
//   riskUsd   = capital × riskPct
//   stopPct   = (entry − stop) / entry
//   positionUsd = riskUsd / stopPct
//   tranches  = positionUsd × split
//
// If the operator only has 2 of 3 tranches filled, the report states
// the ACTUAL average entry and the ACTUAL loss at the shared stop —
// never the planned numbers. Pure; no I/O.
// ─────────────────────────────────────────────────────────────

export type TrancheReason = 'break' | 'retest' | 'reclaim' | 'breakout'

export interface TrancheSpec {
  reason: TrancheReason
  /** Market cap at which this tranche is bought. */
  atMcUsd: number
  /** Fraction of the total position (weights sum to 1). */
  weight: number
}

export interface LadderInput {
  /** Total risk capital available (USD). */
  capitalUsd: number
  /** Fraction of capital risked if the stop hits (0.01 = 1%). */
  riskPct: number
  /** The ONE stop, in MC units. */
  stopUsd: number
  tranches: TrancheSpec[]
}

export interface TranchePlan extends TrancheSpec {
  /** USD notional for this tranche (0 when the stop is invalid). */
  notionalUsd: number
}

export interface LadderPlan {
  valid: boolean
  /** Why the ladder could not be built (null when valid). */
  problem: string | null
  riskUsd: number
  /** Weighted average entry across ALL planned tranches. */
  avgEntryUsd: number
  stopUsd: number
  /** Worst-case loss if every tranche fills and the shared stop hits. */
  lossAtStopUsd: number
  /** Total notional across tranches. */
  positionUsd: number
  tranches: TranchePlan[]
  /** Reward/risk at a target, when supplied. */
  targetUsd: number | null
  rr: number | null
}

export interface FillReport {
  filled: TranchePlan[]
  /** Average entry of the FILLED tranches only. */
  avgEntryUsd: number | null
  /** Actual loss at the shared stop for the filled size. */
  lossAtStopUsd: number | null
  /** Notional actually deployed. */
  deployedUsd: number
}

const MIN_TRANCHES = 2
const MAX_TRANCHES = 3
const WEIGHT_SUM_EPSILON = 1e-6

/**
 * Build a ladder from the risk budget. Rejects (valid=false, with a named
 * problem) when: weights do not sum to 1, a tranche sits at/below the stop
 * ("jangan nambah di bawah SL"), or the stop gives a negative/zero R.
 */
export function planLadder(input: LadderInput, targetUsd?: number | null): LadderPlan {
  const { capitalUsd, riskPct, stopUsd, tranches } = input
  const empty = (problem: string): LadderPlan => ({
    valid: false,
    problem,
    riskUsd: 0,
    avgEntryUsd: 0,
    stopUsd,
    lossAtStopUsd: 0,
    positionUsd: 0,
    tranches: [],
    targetUsd: targetUsd ?? null,
    rr: null,
  })

  if (!(capitalUsd > 0)) return empty('capital must be > 0')
  if (!(riskPct > 0) || riskPct > 0.1) return empty('riskPct must be in (0, 0.1] — a single trade never risks more than 10%')
  if (!(stopUsd > 0)) return empty('stop must be > 0')
  if (tranches.length < MIN_TRANCHES || tranches.length > MAX_TRANCHES) {
    return empty(`use ${MIN_TRANCHES}–${MAX_TRANCHES} tranches (got ${tranches.length})`)
  }

  const weightSum = tranches.reduce((a, t) => a + t.weight, 0)
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_EPSILON) {
    return empty(`tranche weights must sum to 1 (got ${weightSum.toFixed(3)})`)
  }
  const belowStop = tranches.find((t) => t.atMcUsd <= stopUsd)
  if (belowStop) {
    return empty(`tranche at $${belowStop.atMcUsd.toLocaleString()} is at/below the stop — never add under the SL`)
  }

  const avgEntryUsd = tranches.reduce((a, t) => a + t.atMcUsd * t.weight, 0)
  if (!(avgEntryUsd > stopUsd)) return empty('weighted entry must sit above the stop')

  // Size from the stop first (operator's rule), then split by weight.
  const riskUsd = capitalUsd * riskPct
  const stopPct = (avgEntryUsd - stopUsd) / avgEntryUsd
  if (!(stopPct > 0)) return empty('stop distance is zero — cannot size the trade')
  const positionUsd = riskUsd / stopPct

  const planned: TranchePlan[] = tranches.map((t) => ({
    ...t,
    notionalUsd: positionUsd * t.weight,
  }))
  const lossAtStopUsd = planned.reduce(
    (acc, t) => acc + t.notionalUsd * ((t.atMcUsd - stopUsd) / t.atMcUsd),
    0,
  )
  const rr =
    targetUsd !== null && targetUsd !== undefined && targetUsd > avgEntryUsd
      ? (targetUsd / avgEntryUsd - 1) / stopPct
      : null

  return {
    valid: true,
    problem: null,
    riskUsd,
    avgEntryUsd,
    stopUsd,
    lossAtStopUsd,
    positionUsd,
    tranches: planned,
    targetUsd: targetUsd ?? null,
    rr,
  }
}

/**
 * Report what ACTUALLY happened when only some tranches filled — the
 * operator's partial-fill case (2 of 3). Loss is recomputed on real size,
 * never carried over from the plan.
 */
export function reportFills(plan: LadderPlan, filledReasons: TrancheReason[]): FillReport {
  const filled = plan.tranches.filter((t) => filledReasons.includes(t.reason))
  const deployedUsd = filled.reduce((a, t) => a + t.notionalUsd, 0)
  if (filled.length === 0) {
    return { filled: [], avgEntryUsd: null, lossAtStopUsd: null, deployedUsd: 0 }
  }
  const weightSum = filled.reduce((a, t) => a + t.weight, 0)
  const avgEntryUsd = filled.reduce((a, t) => a + t.atMcUsd * t.weight, 0) / weightSum
  // Normalize to the weights actually filled: notional was planned for the
  // full ladder, so re-derive each tranche's slice of what was deployed.
  const filledNormalized = filled.map((t) => ({ ...t, notionalUsd: deployedUsd * (t.weight / weightSum) }))
  const lossAtStopUsd = filledNormalized.reduce(
    (acc, t) => acc + t.notionalUsd * ((t.atMcUsd - plan.stopUsd) / t.atMcUsd),
    0,
  )
  return { filled: filledNormalized, avgEntryUsd, lossAtStopUsd, deployedUsd }
}

/** Default weights for a 3-tranche ladder (operator's 40/30/30). */
export const DEFAULT_WEIGHTS_3 = [0.4, 0.3, 0.3] as const
/** Default weights for a 2-tranche ladder. */
export const DEFAULT_WEIGHTS_2 = [0.6, 0.4] as const
