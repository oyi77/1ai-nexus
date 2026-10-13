// ─────────────────────────────────────────────────────────────
// Meme Sniper — tier calibration.
//
// `summariseByTier` tells us how each tier has actually performed; this
// module turns that history into an operator-readable verdict. It is
// deliberately PURE: no network, no DB, no JSON — the caller supplies the
// per-tier stats and decides what to do with the result.
//
// A tier is demoted when there is enough scored evidence (minScored) and its
// hit rate is below the calibration floor. null hit rate is never judged:
// "no measurable signals" is not the same as "bad signals".
// ─────────────────────────────────────────────────────────────

export interface TierCalibration {
  tier: string
  hitRatePct: number | null
  scored: number
  demoted: boolean
  demotionReason: string | null
  floor: number
}

export const CALIBRATION_FLOOR_PCT = 50

export interface CalibrationOptions {
  /** Hit-rate percentage below which an evidenced tier is demoted. */
  floorPct?: number
  /** Minimum scored signals required before a tier is judged at all. */
  minScored?: number
}

/**
 * Calibrate every tier in the supplied per-tier outcome summary. Pure and
 * deterministic: output is sorted by tier name and no option mutates the
 * input.
 */
export function calibrateTiers(
  byTier: Record<string, { scored: number; hitRatePct: number | null }>,
  opts: CalibrationOptions = {},
): TierCalibration[] {
  const floor = opts.floorPct ?? CALIBRATION_FLOOR_PCT
  const minScored = opts.minScored ?? 5

  return Object.entries(byTier)
    .map(([tier, stats]) => {
      const demoted =
        stats.scored >= minScored && stats.hitRatePct !== null && stats.hitRatePct < floor
      const demotionReason = demoted
        ? `hit rate ${stats.hitRatePct}% < ${floor}% floor over ${stats.scored} scored signals`
        : null

      return {
        tier,
        hitRatePct: stats.hitRatePct,
        scored: stats.scored,
        demoted,
        demotionReason,
        floor,
      }
    })
    .sort((a, b) => a.tier.localeCompare(b.tier))
}

/**
 * One-line human-readable summary of any demotions, or null when the tiers
 * are all within policy. Example:
 *   Tier HIGH_CONVICTION demoted: 40% hit rate over 10 scored signals (floor 50%)
 */
export function demotionSummary(calibrations: TierCalibration[]): string | null {
  const demotions = calibrations.filter((c) => c.demoted)
  if (demotions.length === 0) return null

  return demotions
    .map((c) => {
      const hitRate = c.hitRatePct === null ? 'n/a' : `${c.hitRatePct}%`
      return `Tier ${c.tier} demoted: ${hitRate} hit rate over ${c.scored} scored signals (floor ${c.floor}%)`
    })
    .join(' | ')
}
