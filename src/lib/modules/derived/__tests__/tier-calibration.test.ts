import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_FLOOR_PCT,
  calibrateTiers,
  demotionSummary,
  type TierCalibration,
} from '../tier-calibration'

describe('calibrateTiers', () => {
  it('demotes a tier below floor with >= minScored signals', () => {
    const result = calibrateTiers({ BAD: { scored: 10, hitRatePct: 40 } })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject<Partial<TierCalibration>>({
      tier: 'BAD',
      scored: 10,
      hitRatePct: 40,
      demoted: true,
      floor: CALIBRATION_FLOOR_PCT,
    })
    expect(result[0].demotionReason).toBe(
      'hit rate 40% < 50% floor over 10 scored signals',
    )
  })

  it('does NOT demote below floor when scored < minScored', () => {
    const result = calibrateTiers({ YOUNG: { scored: 4, hitRatePct: 20 } })

    expect(result[0].demoted).toBe(false)
    expect(result[0].demotionReason).toBeNull()
  })

  it('does NOT demote when hitRatePct is null', () => {
    const result = calibrateTiers({ EMPTY: { scored: 10, hitRatePct: null } })

    expect(result[0].demoted).toBe(false)
    expect(result[0].demotionReason).toBeNull()
  })

  it('does NOT demote at exactly the floor (>= floor passes)', () => {
    const result = calibrateTiers({ ON_FLOOR: { scored: 5, hitRatePct: 50 } })

    expect(result[0].demoted).toBe(false)
    expect(result[0].demotionReason).toBeNull()
  })

  it('sorts output by tier name for determinism', () => {
    const result = calibrateTiers({
      ZETA: { scored: 10, hitRatePct: 40 },
      ALPHA: { scored: 10, hitRatePct: 80 },
      MID: { scored: 10, hitRatePct: 60 },
    })

    expect(result.map((c) => c.tier)).toEqual(['ALPHA', 'MID', 'ZETA'])
  })
})

describe('demotionSummary', () => {
  it('returns null when no tiers are demoted', () => {
    const result = calibrateTiers({ GOOD: { scored: 20, hitRatePct: 75 } })

    expect(demotionSummary(result)).toBeNull()
  })

  it('returns a reason one-liner when a tier is demoted', () => {
    const result = calibrateTiers({ HIGH_CONVICTION: { scored: 10, hitRatePct: 40 } })

    expect(demotionSummary(result)).toBe(
      'Tier HIGH_CONVICTION demoted: 40% hit rate over 10 scored signals (floor 50%)',
    )
  })

  it('respects custom floorPct and minScored', () => {
    const result = calibrateTiers(
      { CUSTOM: { scored: 3, hitRatePct: 70 } },
      { floorPct: 75, minScored: 3 },
    )

    expect(result[0].demoted).toBe(true)
    expect(result[0].floor).toBe(75)
    expect(result[0].demotionReason).toBe(
      'hit rate 70% < 75% floor over 3 scored signals',
    )
  })
})
