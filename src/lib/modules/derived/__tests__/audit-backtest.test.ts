// Unit tests for the pure backtest core. Network + JSON I/O are out of
// scope — these cover summariseBacktest, buildBacktestRow, classifyOutcome,
// and the profile-breach extraction seam.
import { describe, it, expect } from 'vitest'
import {
  buildBacktestRow,
  classifyOutcome,
  emptyBucket,
  extractProfileBreaches,
  summariseBacktest,
  type BacktestRow,
  type BacktestRowInput,
} from '../audit-backtest'

function input(over: Partial<BacktestRowInput> = {}): BacktestRowInput {
  return {
    contract: 'mint111111111111111111111111111111111',
    at: '2026-10-13T00:00:00.000Z',
    status: 'REJECT',
    tier: 'REJECT',
    rejectionCount: 1,
    entryMarketCapUsd: 1000,
    distribution: null,
    rejections: [],
    ...over,
  }
}

function row(over: Partial<BacktestRow> = {}): BacktestRow {
  return {
    contract: 'mint111111111111111111111111111111111',
    at: '2026-10-13T00:00:00.000Z',
    status: 'REJECT',
    tier: 'REJECT',
    rejectionCount: 1,
    entryMarketCapUsd: 1000,
    currentPriceUsd: 1000,
    returnPct: 0,
    outcome: 'FLAT',
    distribution: null,
    profileBreaches: [],
    ...over,
  }
}

describe('summariseBacktest — empty and null-rate discipline', () => {
  it('returns null rates (never 0%) for an empty row set', () => {
    const summary = summariseBacktest([])
    expect(summary.totalEvaluated).toBe(0)
    expect(summary.totalPriced).toBe(0)
    expect(summary.winRate).toBeNull()
    expect(summary.stopRate).toBeNull()
    expect(summary.flatRate).toBeNull()
    expect(summary.avgReturnPct).toBeNull()
    expect(summary.byRejectionCount['0'].targetRate).toBeNull()
  })

  it('counts totalEvaluated for a row with no forward data but excludes it from rates', () => {
    const unpriced = row({ currentPriceUsd: null, returnPct: null, outcome: null })
    const summary = summariseBacktest([unpriced])
    expect(summary.totalEvaluated).toBe(1)
    expect(summary.totalPriced).toBe(0)
    expect(summary.winRate).toBeNull()
    expect(summary.byStatus.REJECT.priced).toBe(0)
  })
})

describe('summariseBacktest — outcome counting and averages', () => {
  it('counts TARGET/STOPPED/FLAT and computes winRate + avgReturnPct', () => {
    const rows = [
      row({ contract: 'a', returnPct: 200, outcome: 'TARGET' }),
      row({ contract: 'b', returnPct: -60, outcome: 'STOPPED' }),
      row({ contract: 'c', returnPct: 10, outcome: 'FLAT' }),
      row({ contract: 'd', returnPct: -10, outcome: 'FLAT' }),
    ]
    const summary = summariseBacktest(rows)
    expect(summary.totalPriced).toBe(4)
    expect(summary.targets).toBe(1)
    expect(summary.stops).toBe(1)
    expect(summary.flats).toBe(2)
    expect(summary.winRate).toBeCloseTo(0.25)
    expect(summary.stopRate).toBeCloseTo(0.25)
    expect(summary.flatRate).toBeCloseTo(0.5)
    expect(summary.avgReturnPct).toBeCloseTo((200 - 60 + 10 - 10) / 4)
  })
})

describe('summariseBacktest — buckets', () => {
  it('splits per-status buckets with priced counts and TARGET rates', () => {
    const rows = [
      row({ contract: 'a', status: 'REJECT', returnPct: 150, outcome: 'TARGET' }),
      row({ contract: 'b', status: 'REJECT', returnPct: -10, outcome: 'FLAT' }),
      row({ contract: 'c', status: 'WATCHLIST', returnPct: -70, outcome: 'STOPPED' }),
    ]
    const summary = summariseBacktest(rows)
    expect(summary.byStatus.REJECT.count).toBe(2)
    expect(summary.byStatus.REJECT.targetRate).toBeCloseTo(0.5)
    expect(summary.byStatus.WATCHLIST.stopRate).toBeCloseTo(1)
    expect(summary.byStatus.SIGNAL).toEqual(emptyBucket())
  })

  it('buckets rejection counts into 0, 1, 2, 3+', () => {
    const rows = [
      row({ contract: 'a', rejectionCount: 0 }),
      row({ contract: 'b', rejectionCount: 1, returnPct: 200, outcome: 'TARGET' }),
      row({ contract: 'c', rejectionCount: 3 }),
      row({ contract: 'd', rejectionCount: 9, returnPct: -80, outcome: 'STOPPED' }),
    ]
    const summary = summariseBacktest(rows)
    expect(summary.byRejectionCount['0'].count).toBe(1)
    expect(summary.byRejectionCount['1'].targetRate).toBeCloseTo(1)
    expect(summary.byRejectionCount['3+'].count).toBe(2)
    expect(summary.byRejectionCount['3+'].stopRate).toBeCloseTo(0.5)
  })
})

describe('summariseBacktest — per-profile rates', () => {
  it('computes TARGET/STOPPED rates for each breached profile', () => {
    const rows = [
      row({
        contract: 'a',
        returnPct: 150,
        outcome: 'TARGET',
        profileBreaches: ['golden-new-pairs', 'exposure-early'],
      }),
      row({
        contract: 'b',
        returnPct: -70,
        outcome: 'STOPPED',
        profileBreaches: ['golden-new-pairs'],
      }),
    ]
    const summary = summariseBacktest(rows)
    expect(summary.byProfile['golden-new-pairs'].count).toBe(2)
    expect(summary.byProfile['golden-new-pairs'].targetRate).toBeCloseTo(0.5)
    expect(summary.byProfile['golden-new-pairs'].stopRate).toBeCloseTo(0.5)
    expect(summary.byProfile['exposure-early'].targetRate).toBeCloseTo(1)
    expect(summary.byProfile['exposure-early'].stopRate).toBeCloseTo(0)
  })
})

describe('classifyOutcome — shared bands, no fabricated flats', () => {
  it('uses +100%/-50% bands from the outcome defaults', () => {
    expect(classifyOutcome(1000, 2000).outcome).toBe('TARGET')
    expect(classifyOutcome(1000, 500).outcome).toBe('STOPPED')
    expect(classifyOutcome(1000, 1000).outcome).toBe('FLAT')
  })

  it('returns null outcome for a null/NaN/<=0 price', () => {
    expect(classifyOutcome(1000, null).outcome).toBeNull()
    expect(classifyOutcome(1000, Number.NaN).outcome).toBeNull()
    expect(classifyOutcome(1000, 0).outcome).toBeNull()
  })
})

describe('buildBacktestRow and extractProfileBreaches — row-building seam', () => {
  it('builds a priced row with the right returnPct and outcome', () => {
    const built = buildBacktestRow(input({ entryMarketCapUsd: 1000 }), 2500)
    expect(built.returnPct).toBe(150)
    expect(built.outcome).toBe('TARGET')
    expect(built.distribution).toBeNull()
  })

  it('parses only known [profile] prefixes and ignores plain rejections', () => {
    const rejections = [
      'Top 10 hold 100% (ceiling 30%)',
      '[golden-new-pairs] Single Whale (99 vs single-whale ≤ 5%)',
      '[unknown-profile] whatever',
      '[exposure-early] Top Holders (100 vs top-holders ≤ 40%)',
    ]
    expect(extractProfileBreaches(rejections)).toEqual(['golden-new-pairs', 'exposure-early'])
    expect(extractProfileBreaches(undefined)).toEqual([])
  })
})
