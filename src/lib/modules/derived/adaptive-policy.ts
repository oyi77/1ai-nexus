// ─────────────────────────────────────────────────────────────
// Meme Sniper — adaptive delivery policy.
//
// `calibrateTiers` turns per-tier outcome history into demotion verdicts;
// this module turns those verdicts into a concrete `DeliveryPolicy`.
// A tier that has been demoted on evidence (enough scored signals, hit
// rate below the floor) is cut off — it can never be promoted above the
// base policy the caller supplied.
//
// Pure — zero I/O, zero env reads. Env-gating (`SNIPER_ADAPTIVE_POLICY`)
// is deliberately the CALLER's job: this module only maps history → policy.
// ─────────────────────────────────────────────────────────────

import type { DeliveryPolicy } from './signal-tier'
import { calibrateTiers } from './tier-calibration'

export interface AdaptivePolicyInput {
  /** The policy the caller would use without adaptation (spread, never mutated). */
  base: DeliveryPolicy
  /** Per-tier outcome stats, exactly as produced by `summariseByTier`. */
  byTier: Record<string, { scored: number; hitRatePct: number | null }>
  opts?: {
    /** Hit-rate percentage below which an evidenced tier is demoted. */
    floorPct?: number
    /** Minimum scored signals required before a tier is judged at all. */
    minScored?: number
    /** When false, WATCHLIST/CANDIDATE demotions never flip allowWatchlist. */
    demoteWatchlist?: boolean
  }
}

/**
 * Derive a delivery policy from `base` plus per-tier calibration verdicts.
 * Pure and deterministic: the base policy is spread, flags are only ever
 * set to false (never promoted), and only demoted tiers are acted on.
 */
export function adaptDeliveryPolicy(input: AdaptivePolicyInput): DeliveryPolicy {
  const policy: DeliveryPolicy = { ...input.base }
  const demoteWatchlist = input.opts?.demoteWatchlist ?? true

  const calibrations = calibrateTiers(input.byTier, {
    floorPct: input.opts?.floorPct,
    minScored: input.opts?.minScored,
  })

  for (const calibration of calibrations) {
    if (!calibration.demoted) continue
    if (calibration.tier === 'HIGH_CONVICTION') {
      policy.allowTopSignal = false
    } else if ((calibration.tier === 'WATCHLIST' || calibration.tier === 'CANDIDATE') && demoteWatchlist) {
      policy.allowWatchlist = false
    }
  }

  return policy
}

/**
 * Human one-liner of what `adaptDeliveryPolicy` would change and why, or
 * null when the derived policy equals the base. A flag that is already
 * false on the base is never reported as a change (nothing was demoted).
 */
export function adaptivePolicyReason(input: AdaptivePolicyInput): string | null {
  const base = input.base
  const demoteWatchlist = input.opts?.demoteWatchlist ?? true

  const calibrations = calibrateTiers(input.byTier, {
    floorPct: input.opts?.floorPct,
    minScored: input.opts?.minScored,
  })

  const changes: string[] = []
  for (const calibration of calibrations) {
    if (!calibration.demoted) continue
    const hitRate = calibration.hitRatePct === null ? 'n/a' : `${calibration.hitRatePct}%`
    const why = `${calibration.tier}: ${hitRate} hit rate over ${calibration.scored} scored (floor ${calibration.floor}%)`
    if (calibration.tier === 'HIGH_CONVICTION' && base.allowTopSignal) {
      changes.push(`${why} → allowTopSignal=false`)
    } else if (
      (calibration.tier === 'WATCHLIST' || calibration.tier === 'CANDIDATE') &&
      demoteWatchlist &&
      base.allowWatchlist
    ) {
      changes.push(`${why} → allowWatchlist=false`)
    }
  }

  return changes.length > 0 ? changes.join(' | ') : null
}
