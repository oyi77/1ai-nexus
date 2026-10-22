import { describe, it, expect } from 'vitest'
import {
  registerDelivered,
  registerDeliveries,
  scoreSignal,
  sweepOutcomes,
  summariseOutcomes,
  summariseByTier,
  emptyOutcomeLog,
  OUTCOME_DEFAULTS,
  type SignalOutcome,
} from './sniper-outcomes'

const T0 = '2026-10-12T00:00:00.000Z'
const DUE = '2026-10-13T00:00:00.000Z' // +24h

function pending(over: Partial<SignalOutcome> = {}): SignalOutcome {
  return {
    contract: 'mint111',
    ticker: 'TOK',
    tier: 'WATCHLIST',
    deliveredAt: T0,
    entryMarketCapUsd: 1_000_000,
    horizonHours: 24,
    dueAt: DUE,
    exitMarketCapUsd: null,
    returnPct: null,
    verdict: 'PENDING',
    scoredAt: null,
    ...over,
  }
}

describe('outcome registration — never invent an entry', () => {
  it('registers a delivered signal as PENDING with a due time', () => {
    const log = registerDelivered(emptyOutcomeLog(), {
      contract: 'mint111',
      ticker: 'TOK',
      tier: 'WATCHLIST',
      entryMarketCapUsd: 1_000_000,
      deliveredAt: T0,
    })
    expect(log.signals).toHaveLength(1)
    expect(log.signals[0].verdict).toBe('PENDING')
    expect(log.signals[0].dueAt).toBe(DUE)
  })

  it('is UNPRICEABLE when the entry was never proven — never watchable', () => {
    const log = registerDelivered(emptyOutcomeLog(), {
      contract: 'mint111',
      ticker: 'TOK',
      tier: 'WATCHLIST',
      entryMarketCapUsd: null,
      deliveredAt: T0,
    })
    expect(log.signals[0].verdict).toBe('UNPRICEABLE')
    expect(log.signals[0].dueAt).toBeNull()
  })

  it('is idempotent by contract — the first delivery is the entry', () => {
    let log = registerDelivered(emptyOutcomeLog(), {
      contract: 'mint111',
      ticker: 'TOK',
      tier: 'WATCHLIST',
      entryMarketCapUsd: 1_000_000,
      deliveredAt: T0,
    })
    log = registerDelivered(log, {
      contract: 'mint111',
      ticker: 'TOK2',
      tier: 'HIGH_CONVICTION',
      entryMarketCapUsd: 2_000_000,
      deliveredAt: '2026-10-12T06:00:00.000Z',
    })
    expect(log.signals).toHaveLength(1)
    expect(log.signals[0].entryMarketCapUsd).toBe(1_000_000)
    expect(log.signals[0].ticker).toBe('TOK')
  })
})

describe('outcome scoring — the window is fixed at delivery', () => {
  it('does not score before the due time', () => {
    const out = scoreSignal(pending(), { marketCapUsd: 5_000_000, observedAt: '2026-10-12T12:00:00.000Z' })
    expect(out.verdict).toBe('PENDING')
    expect(out.returnPct).toBeNull()
  })

  it('scores TARGET on a double at the bar', () => {
    const out = scoreSignal(pending(), { marketCapUsd: 2_000_000, observedAt: DUE })
    expect(out.verdict).toBe('TARGET')
    expect(out.returnPct).toBeCloseTo(1, 9)
  })

  it('scores STOPPED on a halve', () => {
    const out = scoreSignal(pending(), { marketCapUsd: 500_000, observedAt: DUE })
    expect(out.verdict).toBe('STOPPED')
  })

  it('scores a +20% move as WIN and a -20% move as LOSS, never as FLAT', () => {
    const up = scoreSignal(pending(), { marketCapUsd: 1_200_000, observedAt: DUE })
    expect(up.verdict).toBe('WIN')
    expect(up.returnPct).toBeCloseTo(0.2, 9)
    const down = scoreSignal(pending(), { marketCapUsd: 800_000, observedAt: DUE })
    expect(down.verdict).toBe('LOSS')
    expect(down.returnPct).toBeCloseTo(-0.2, 9)
  })

  it('treats the flat band edges as real moves: +10% WIN, -10% LOSS, ±9.9% FLAT', () => {
    expect(scoreSignal(pending(), { marketCapUsd: 1_100_000, observedAt: DUE }).verdict).toBe('WIN')
    expect(scoreSignal(pending(), { marketCapUsd: 1_099_000, observedAt: DUE }).verdict).toBe('FLAT')
    expect(scoreSignal(pending(), { marketCapUsd: 901_000, observedAt: DUE }).verdict).toBe('FLAT')
    expect(scoreSignal(pending(), { marketCapUsd: 900_000, observedAt: DUE }).verdict).toBe('LOSS')
  })

  it('refuses a null observation — no price, no verdict', () => {
    expect(scoreSignal(pending(), null).verdict).toBe('PENDING')
    expect(scoreSignal(pending(), { marketCapUsd: null, observedAt: DUE }).verdict).toBe('PENDING')
  })

  it('never re-scores UNPRICEABLE', () => {
    const unp = pending({ verdict: 'UNPRICEABLE', entryMarketCapUsd: null, dueAt: null })
    expect(scoreSignal(unp, { marketCapUsd: 9_000_000, observedAt: DUE }).verdict).toBe('UNPRICEABLE')
  })
})

describe('outcome summary — unmeasurable is not a miss', () => {
  it('reports null hit rate when nothing is scored', () => {
    const stats = summariseOutcomes([pending(), pending({ contract: 'mint222' })])
    expect(stats.scored).toBe(0)
    expect(stats.hitRatePct).toBeNull()
    expect(stats.avgReturnPct).toBeNull()
    expect(stats.pending).toBe(2)
  })

  it('counts every measured verdict in scored but keeps hit rate on targets only', () => {
    const stats = summariseOutcomes([
      pending({ contract: 'a', verdict: 'TARGET', returnPct: 1.5 }),
      pending({ contract: 'b', verdict: 'STOPPED', returnPct: -0.6 }),
      pending({ contract: 'c', verdict: 'FLAT', returnPct: 0.05 }),
      pending({ contract: 'd', verdict: 'WIN', returnPct: 0.2 }),
      pending({ contract: 'e', verdict: 'LOSS', returnPct: -0.2 }),
      pending({ contract: 'f', verdict: 'PENDING' }),
      pending({ contract: 'g', verdict: 'UNPRICEABLE' }),
    ])
    expect(stats.scored).toBe(5)
    expect(stats.targets).toBe(1)
    expect(stats.wins).toBe(1)
    expect(stats.losses).toBe(1)
    expect(stats.stopped).toBe(1)
    expect(stats.flat).toBe(1)
    expect(stats.winRatePct).toBeCloseTo(50, 9)
    expect(stats.hitRatePct).toBeCloseTo(20, 9)
    expect(stats.avgReturnPct).toBeCloseTo(((1.5 - 0.6 + 0.05 + 0.2 - 0.2) / 5) * 100, 9)
    expect(stats.pending).toBe(1)
    expect(stats.unpriceable).toBe(1)
  })

  it('the horizon default is 24h — evidence for the operator doc', () => {
    expect(OUTCOME_DEFAULTS.horizonHours).toBe(24)
    expect(OUTCOME_DEFAULTS.targetReturn).toBe(1.0)
    expect(OUTCOME_DEFAULTS.stopReturn).toBe(-0.5)
  })
})

describe('per-tier summary — which tier to trust', () => {
  it('a tier with no scored signals reports null, not 0%', () => {
    const by = summariseByTier([pending({ tier: 'HIGH_CONVICTION' })])
    expect(by.HIGH_CONVICTION.hitRatePct).toBeNull()
  })

  it('separates performance by tier', () => {
    const by = summariseByTier([
      pending({ contract: 'a', tier: 'HIGH_CONVICTION', verdict: 'TARGET', returnPct: 2 }),
      pending({ contract: 'b', tier: 'HIGH_CONVICTION', verdict: 'FLAT', returnPct: 0.1 }),
      pending({ contract: 'c', tier: 'WATCHLIST', verdict: 'STOPPED', returnPct: -0.6 }),
    ])
    expect(by.HIGH_CONVICTION.hitRatePct).toBeCloseTo(50, 9)
    expect(by.WATCHLIST.hitRatePct).toBe(0)
  })
})

describe('scoring idempotency — sweeps never double-count', () => {
  it('a scored signal re-scored with the same observation is unchanged', () => {
    const once = scoreSignal(pending(), { marketCapUsd: 2_500_000, observedAt: DUE })
    const twice = scoreSignal(once, { marketCapUsd: 2_500_000, observedAt: DUE })
    expect(twice.returnPct).toBe(once.returnPct)
    expect(twice.verdict).toBe('TARGET')
  })

  it('a later observation replaces the exit, it does not add a row', () => {
    const once = scoreSignal(pending(), { marketCapUsd: 1_500_000, observedAt: DUE })
    const later = scoreSignal(once, { marketCapUsd: 3_000_000, observedAt: '2026-10-13T06:00:00.000Z' })
    expect(later.exitMarketCapUsd).toBe(3_000_000)
    expect(later.returnPct).toBeCloseTo(2, 9)
  })
})

describe('registerDeliveries — only pushes the operator acted on', () => {
  it('ignores undelivered decisions', () => {
    const log = registerDeliveries(
      emptyOutcomeLog(),
      [
        { contract: 'a', ticker: 'A', tier: 'WATCHLIST', delivered: false, market: { marketCapUsd: 5 } },
        { contract: 'b', ticker: 'B', tier: 'WATCHLIST', delivered: true, market: { marketCapUsd: 1_000_000 } },
      ],
      T0,
    )
    expect(log.signals.map((s) => s.contract)).toEqual(['b'])
  })

  it('marks a delivered signal with no proven market cap UNPRICEABLE', () => {
    const log = registerDeliveries(
      emptyOutcomeLog(),
      [{ contract: 'a', ticker: 'A', tier: 'WATCHLIST', delivered: true, market: { marketCapUsd: null } }],
      T0,
    )
    expect(log.signals[0].verdict).toBe('UNPRICEABLE')
  })
})

describe('sweepOutcomes — an unobserved signal is never a miss', () => {
  it('leaves a signal off the price list PENDING', () => {
    const log = registerDelivered(emptyOutcomeLog(), {
      contract: 'gone',
      ticker: 'G',
      tier: 'WATCHLIST',
      entryMarketCapUsd: 1_000_000,
      deliveredAt: T0,
    })
    const swept = sweepOutcomes(log, [])
    expect(swept.signals[0].verdict).toBe('PENDING')
  })

  it('scores a due signal from its observation', () => {
    const log = registerDelivered(emptyOutcomeLog(), {
      contract: 'up',
      ticker: 'U',
      tier: 'WATCHLIST',
      entryMarketCapUsd: 1_000_000,
      deliveredAt: T0,
    })
    const swept = sweepOutcomes(log, [{ contract: 'up', marketCapUsd: 3_000_000, observedAt: DUE }])
    expect(swept.signals[0].verdict).toBe('TARGET')
  })

  it('does not re-score an already-final verdict', () => {
    const log = registerDelivered(emptyOutcomeLog(), {
      contract: 'up',
      ticker: 'U',
      tier: 'WATCHLIST',
      entryMarketCapUsd: 1_000_000,
      deliveredAt: T0,
    })
    const once = sweepOutcomes(log, [{ contract: 'up', marketCapUsd: 3_000_000, observedAt: DUE }])
    const twice = sweepOutcomes(once, [{ contract: 'up', marketCapUsd: 10_000, observedAt: DUE }])
    expect(twice.signals[0].returnPct).toBeCloseTo(2, 9)
  })
})
