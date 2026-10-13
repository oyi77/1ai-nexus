import { describe, expect, it } from 'vitest'
import {
  emptyOutcomeLog,
  extractProfileBreaches,
  extractProfileIds,
  registerDeliveries,
  summariseByProfile,
  summariseOutcomes,
  type SignalOutcome,
} from '../sniper-outcomes'

const T0 = '2026-10-12T00:00:00.000Z'

function signal(over: Partial<SignalOutcome> = {}): SignalOutcome {
  return {
    contract: 'mint111',
    ticker: 'TOK',
    tier: 'HIGH_CONVICTION',
    deliveredAt: T0,
    entryMarketCapUsd: 1_000_000,
    horizonHours: 24,
    dueAt: null,
    exitMarketCapUsd: null,
    returnPct: null,
    verdict: 'PENDING',
    scoredAt: null,
    ...over,
  }
}

describe('extractProfileIds — bracket prefixes only', () => {
  it('keeps known profiles, drops non-profile and bare strings, dedupes and sorts', () => {
    const ids = extractProfileIds([
      'bare string',
      '[not-a-profile] single whale',
      '[exposure-early] top holders ≤ 40%',
      '[golden-new-pairs] single whale ≤ 5%',
      '[exposure-early] duplicate exposure breach',
    ])
    expect(ids).toEqual(['exposure-early', 'golden-new-pairs'])
  })

  it('returns [] when nothing matches', () => {
    expect(extractProfileIds(['no bracket', '[random-tag] x'])).toEqual([])
  })
})

describe('extractProfileBreaches — full strings only', () => {
  it('returns only profile-attributed strings', () => {
    const breaches = extractProfileBreaches([
      '[golden-new-pairs] Single Whale (100 vs single-whale ≤ 5%)',
      '[random-tag] ignored',
      'no bracket ignored',
      '[sniper-launch] Top Holders (100 vs top-holders ≤ 40%)',
    ])
    expect(breaches).toEqual([
      '[golden-new-pairs] Single Whale (100 vs single-whale ≤ 5%)',
      '[sniper-launch] Top Holders (100 vs top-holders ≤ 40%)',
    ])
  })
})

describe('registerDeliveries — profile attribution from rejections + warnings', () => {
  it('populates profileIds and profileBreaches from both arrays', () => {
    const log = registerDeliveries(
      emptyOutcomeLog(),
      [
        {
          contract: 'a',
          ticker: 'A',
          tier: 'HIGH_CONVICTION',
          delivered: true,
          market: { marketCapUsd: 1_000_000 },
          rejections: ['[golden-new-pairs] Single Whale (100 vs single-whale ≤ 5%)'],
          warnings: ['[exposure-early] Top Holders (100 vs top-holders ≤ 40%)', 'plain warning'],
        },
      ],
      T0,
    )
    expect(log.signals[0].profileIds).toEqual(['exposure-early', 'golden-new-pairs'])
    expect(log.signals[0].profileBreaches).toEqual([
      '[golden-new-pairs] Single Whale (100 vs single-whale ≤ 5%)',
      '[exposure-early] Top Holders (100 vs top-holders ≤ 40%)',
    ])
  })
})

describe('summariseByProfile — which profile predicts winners', () => {
  it('keys only on profileIds-carrying signals and mirrors tier hit-rate semantics', () => {
    const by = summariseByProfile([
      signal({ contract: 'a', verdict: 'TARGET', returnPct: 1.2, profileIds: ['golden-new-pairs'] }),
      signal({ contract: 'b', verdict: 'FLAT', returnPct: 0.1, profileIds: ['golden-new-pairs', 'sniper-launch'] }),
      signal({ contract: 'c', verdict: 'STOPPED', returnPct: -0.6, profileIds: ['sniper-launch'] }),
      signal({ contract: 'd', verdict: 'TARGET', returnPct: 2 }), // no profileIds → excluded
    ])
    expect(Object.keys(by).sort()).toEqual(['golden-new-pairs', 'sniper-launch'])
    expect(by['golden-new-pairs'].scored).toBe(2)
    expect(by['golden-new-pairs'].hitRatePct).toBeCloseTo(50, 9)
    expect(by['sniper-launch'].scored).toBe(2)
    expect(by['sniper-launch'].hitRatePct).toBe(0)
  })
})

describe('backward compat — pre-attribution records still score', () => {
  it('a signal without profileIds passes through summariseOutcomes unchanged', () => {
    const stats = summariseOutcomes([
      signal({ contract: 'old', verdict: 'TARGET', returnPct: 1.5 }),
    ])
    expect(stats.scored).toBe(1)
    expect(stats.hitRatePct).toBeCloseTo(100, 9)
  })
})
