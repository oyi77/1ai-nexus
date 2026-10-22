import { describe, it, expect } from 'vitest'
import {
  HORIZON_KEYS,
  MC_BUCKET_KEYS,
  OUTCOME_HORIZONS,
  RISK_BUCKET_KEYS,
  WALLET_QUALITY_KEYS,
  groupByMcBucket,
  groupByRisk,
  groupByWalletQuality,
  horizonOutcomes,
  mcBucketKey,
  projectHorizonSignals,
  scoreSignalAtHorizon,
  summariseHorizons,
  walletQualityFromStrongest,
} from '../outcome-horizons'
import { summariseOutcomes, type SignalOutcome } from '../sniper-outcomes'

const T0 = '2026-10-12T00:00:00.000Z'

function signal(over: Partial<SignalOutcome> = {}): SignalOutcome {
  return {
    contract: 'mint111',
    ticker: 'TOK',
    tier: 'WATCHLIST',
    deliveredAt: T0,
    entryMarketCapUsd: 1_000_000,
    horizonHours: 24,
    dueAt: '2026-10-13T00:00:00.000Z',
    exitMarketCapUsd: null,
    returnPct: null,
    verdict: 'PENDING',
    scoredAt: null,
    ...over,
  }
}

function obs(marketCapUsd: number | null, observedAt: string) {
  return { marketCapUsd, observedAt }
}

describe('scoreSignalAtHorizon — the window starts at delivery', () => {
  it('h1 is due only after 1h; an observation before the bar stays PENDING', () => {
    const scored = scoreSignalAtHorizon(
      signal(),
      obs(2_000_000, '2026-10-12T00:30:00.000Z'),
      OUTCOME_HORIZONS.h1,
    )
    expect(scored.verdict).toBe('PENDING')
    expect(scored.returnPct).toBeNull()
    expect(scored.horizonHours).toBe(1)
    expect(scored.dueAt).toBe('2026-10-12T01:00:00.000Z')
  })

  it('scores an observation at exactly the due bar', () => {
    const scored = scoreSignalAtHorizon(
      signal(),
      obs(2_000_000, '2026-10-12T01:00:00.000Z'),
      OUTCOME_HORIZONS.h1,
    )
    expect(scored.verdict).toBe('TARGET')
    expect(scored.returnPct).toBeCloseTo(1, 9)
    expect(scored.scoredAt).not.toBeNull()
  })

  it('classifies a +100% by 4h as TARGET even when the 24h verdict later falls back to WIN', () => {
    const h4 = scoreSignalAtHorizon(
      signal(),
      obs(2_000_000, '2026-10-12T04:00:00.000Z'),
      OUTCOME_HORIZONS.h4,
    )
    const h24 = scoreSignalAtHorizon(
      signal(),
      obs(1_100_000, '2026-10-13T00:00:00.000Z'),
      OUTCOME_HORIZONS.h24,
    )
    expect(h4.verdict).toBe('TARGET')
    expect(h24.verdict).toBe('WIN')
  })
})

describe('horizonOutcomes — per-horizon projection of one signal', () => {
  it('leaves a horizon PENDING with null verdict when no observation reaches its bar', () => {
    const horizons = horizonOutcomes(signal(), [
      obs(2_000_000, '2026-10-12T00:30:00.000Z'),
      obs(3_000_000, '2026-10-12T00:59:00.000Z'),
    ])
    expect(horizons.h1).toEqual({ returnPct: null, verdict: 'PENDING', dueAt: '2026-10-12T01:00:00.000Z' })
    expect(horizons.h4.returnPct).toBeNull()
    expect(horizons.h4.verdict).toBe('PENDING')
    expect(horizons.d7.dueAt).toBe('2026-10-19T00:00:00.000Z')
  })

  it('returns four horizon buckets with the observation closest to each bar', () => {
    const horizons = horizonOutcomes(signal(), [
      obs(1_500_000, '2026-10-12T00:30:00.000Z'), // before +1h — ignored
      obs(2_000_000, '2026-10-12T01:02:00.000Z'), // closest to +1h
      obs(3_000_000, '2026-10-12T04:01:00.000Z'), // closest to +4h
      obs(1_200_000, '2026-10-13T00:02:00.000Z'), // closest to +24h
      obs(400_000, '2026-10-19T00:02:00.000Z'), // closest to +7d
    ])
    expect(HORIZON_KEYS).toEqual(['h1', 'h4', 'h24', 'd7'])
    expect(horizons.h1.verdict).toBe('TARGET')
    expect(horizons.h1.returnPct).toBeCloseTo(1, 9)
    expect(horizons.h4.verdict).toBe('TARGET')
    expect(horizons.h4.returnPct).toBeCloseTo(2, 9)
    expect(horizons.h24.verdict).toBe('WIN')
    expect(horizons.d7.verdict).toBe('STOPPED')
  })
})

describe('projectHorizonSignals + summariseHorizons — aggregate shape', () => {
  it('projects every signal into the four horizon arrays', () => {
    const byContract = new Map([
      [
        'mint111',
        [
          obs(2_000_000, '2026-10-12T01:00:00.000Z'),
          obs(2_000_000, '2026-10-12T04:00:00.000Z'),
          obs(1_100_000, '2026-10-13T00:00:00.000Z'),
          obs(1_100_000, '2026-10-19T00:00:00.000Z'),
        ],
      ],
      [
        'mint222',
        [
          obs(400_000, '2026-10-12T01:00:00.000Z'),
          obs(500_000, '2026-10-12T04:00:00.000Z'),
          obs(500_000, '2026-10-13T00:00:00.000Z'),
          obs(500_000, '2026-10-19T00:00:00.000Z'),
        ],
      ],
    ])

    const projected = projectHorizonSignals(
      [
        signal({ contract: 'mint111' }),
        signal({ contract: 'mint222', entryMarketCapUsd: 800_000 }),
      ],
      byContract,
    )

    expect(projected.h1.map((s) => s.verdict)).toEqual(['TARGET', 'STOPPED'])
    expect(projected.h4.map((s) => s.verdict)).toEqual(['TARGET', 'LOSS'])
    expect(projected.h24.map((s) => s.verdict)).toEqual(['WIN', 'LOSS'])
    expect(projected.d7.map((s) => s.verdict)).toEqual(['WIN', 'LOSS'])
  })

  it('summariseHorizons aggregates hitRatePct and avgReturnPct correctly', () => {
    const projected = projectHorizonSignals(
      [signal({ contract: 'mint111' }), signal({ contract: 'mint222', entryMarketCapUsd: 500_000 })],
      new Map([
        ['mint111', [obs(2_000_000, '2026-10-12T01:00:00.000Z')]],
        ['mint222', [obs(400_000, '2026-10-12T01:00:00.000Z')]],
      ]),
    )
    const byHorizon = summariseHorizons(projected)

    expect(byHorizon.h1.scored).toBe(2)
    expect(byHorizon.h1.hitRatePct).toBeCloseTo(50, 9)
    expect(byHorizon.h1.avgReturnPct).toBeCloseTo(((1 + -0.2) / 2) * 100, 9)
    // Horizons with no due observation are PENDING, not a miss.
    expect(byHorizon.h4.scored).toBe(0)
    expect(byHorizon.h4.hitRatePct).toBeNull()
    expect(byHorizon.h4.avgReturnPct).toBeNull()
  })

  it('a plain SignalOutcome without profileIds still projects and summarises', () => {
    const plain = signal()
    delete plain.profileIds
    delete plain.profileBreaches

    const projected = projectHorizonSignals([plain], new Map([]))
    const byHorizon = summariseHorizons(projected)
    expect(byHorizon.h1.pending).toBe(1)
    expect(byHorizon.d7.pending).toBe(1)
    expect(summariseOutcomes([plain]).hitRatePct).toBeNull()
  })
})

describe('groupByWalletQuality — quality bucket hit rates', () => {
  it('WHALE bucket hit rate is correct', () => {
    const by = groupByWalletQuality(
      [
        signal({ contract: 'a', verdict: 'TARGET', returnPct: 2 }),
        signal({ contract: 'b', verdict: 'FLAT', returnPct: 0.1 }),
        signal({ contract: 'c', verdict: 'TARGET', returnPct: 1 }),
      ],
      new Map([
        ['a', 'WHALE'],
        ['b', 'WHALE'],
        ['c', 'SMART'],
      ]),
    )
    expect(by.WHALE.hitRatePct).toBeCloseTo(50, 9)
    expect(by.SMART.hitRatePct).toBe(100)
  })

  it('NONE is the fallback bucket when quality is missing', () => {
    const by = groupByWalletQuality(
      [signal({ contract: 'a', verdict: 'TARGET', returnPct: 2 })],
      new Map(),
    )
    expect(by.NONE.scored).toBe(1)
    expect(by.NONE.hitRatePct).toBe(100)
    expect(by.WHALE.scored).toBe(0)
  })

  it('empty signals leave every bucket with null hit rate, never 0%', () => {
    const by = groupByWalletQuality([], new Map())
    for (const key of WALLET_QUALITY_KEYS) {
      expect(by[key].scored).toBe(0)
      expect(by[key].hitRatePct).toBeNull()
      expect(by[key].avgReturnPct).toBeNull()
    }
  })

  it('maps strongest wallet labels to the four-bucket vocabulary', () => {
    expect(walletQualityFromStrongest('WHALE_AND_SMART_MONEY')).toBe('MIXED')
    expect(walletQualityFromStrongest('WHALE')).toBe('WHALE')
    expect(walletQualityFromStrongest('QUALIFIED_SMART_MONEY')).toBe('SMART')
    expect(walletQualityFromStrongest(null)).toBe('NONE')
  })
})

describe('groupByMcBucket — entry market cap buckets', () => {
  it('places contracts in <100k, 100k-1M, >1M and unknown buckets', () => {
    const by = groupByMcBucket(
      [
        signal({ contract: 'small', verdict: 'TARGET', returnPct: 1 }),
        signal({ contract: 'mid', verdict: 'FLAT', returnPct: 0.2 }),
        signal({ contract: 'large', verdict: 'TARGET', returnPct: 1 }),
        signal({ contract: 'none', verdict: 'STOPPED', returnPct: -0.6 }),
      ],
      new Map([
        ['small', 99_999],
        ['mid', 1_000_000],
        ['large', 2_000_000],
        ['none', null],
      ]),
    )
    expect(MC_BUCKET_KEYS).toEqual(['<100k', '100k-1M', '>1M', 'unknown'])
    expect(by['<100k'].hitRatePct).toBe(100)
    expect(by['100k-1M'].hitRatePct).toBe(0)
    expect(by['>1M'].hitRatePct).toBe(100)
    expect(by.unknown.hitRatePct).toBe(0)
  })

  it('mcBucketKey keeps boundaries inclusive', () => {
    expect(mcBucketKey(99_999.99)).toBe('<100k')
    expect(mcBucketKey(100_000)).toBe('100k-1M')
    expect(mcBucketKey(1_000_000)).toBe('100k-1M')
    expect(mcBucketKey(1_000_000.01)).toBe('>1M')
    expect(mcBucketKey(null)).toBe('unknown')
  })
})

describe('groupByRisk — risk buckets', () => {
  it('buckets by HIGH/MED/LOW and falls back to UNKNOWN', () => {
    const by = groupByRisk(
      [
        signal({ contract: 'a', verdict: 'TARGET', returnPct: 1 }),
        signal({ contract: 'b', verdict: 'FLAT', returnPct: 0.1 }),
        signal({ contract: 'c', verdict: 'TARGET', returnPct: 1 }),
      ],
      new Map([
        ['a', 'HIGH'],
        ['b', 'LOW'],
      ]),
    )
    expect(RISK_BUCKET_KEYS).toEqual(['HIGH', 'MED', 'LOW', 'UNKNOWN'])
    expect(by.HIGH.hitRatePct).toBe(100)
    expect(by.LOW.hitRatePct).toBe(0)
    expect(by.UNKNOWN.hitRatePct).toBe(100)
    expect(by.MED.hitRatePct).toBeNull()
  })
})
