import { describe, it, expect } from 'vitest'
import { classifyAccumulation, ACCUMULATION_DEFAULTS, type AccumulationReading } from './sniper-accumulation'

function reading(over: Partial<AccumulationReading> = {}): AccumulationReading {
  return {
    at: '2026-10-12T00:00:00.000Z',
    devPercent: 0,
    sniperPercent: 1,
    bundlerPercent: 4,
    insiderPercent: 2,
    top10Percent: 18,
    clusterPercent: 0.4,
    marketCapUsd: 1_000_000,
    liquidityUsd: 50_000,
    volume5mUsd: 600_000,
    ...over,
  }
}

describe('accumulation phase — UNKNOWN discipline', () => {
  it('is UNKNOWN with one reading — a snapshot has no direction', () => {
    const out = classifyAccumulation([reading()])
    expect(out.verdict).toBe('UNKNOWN')
    expect(out.reason).toContain('2 readings')
  })

  it('is UNKNOWN with zero readings', () => {
    const out = classifyAccumulation([])
    expect(out.verdict).toBe('UNKNOWN')
  })

  it('is UNKNOWN when no tier has two proven readings', () => {
    const out = classifyAccumulation([
      reading({
        devPercent: null,
        sniperPercent: null,
        bundlerPercent: null,
        insiderPercent: null,
      }),
      reading({
        devPercent: null,
        sniperPercent: null,
        bundlerPercent: null,
        insiderPercent: null,
      }),
    ])
    expect(out.verdict).toBe('UNKNOWN')
    expect(out.reason).toContain('unprovable')
  })

  it('never counts a missing tier as an exit — unknown UNKNOWN, not 0', () => {
    const out = classifyAccumulation([
      reading({ devPercent: 3, sniperPercent: 2 }),
      reading({ devPercent: null, sniperPercent: 0.2 }),
    ])
    expect(out.evidence.some((e) => e.includes('dev: delta unproven'))).toBe(true)
    expect(out.evidence.some((e) => e.includes('dev: supply leaving'))).toBe(false)
  })
})

describe('accumulation phase — verdict geometry', () => {
  const base = () => ({
    at: '2026-10-12T00:00:00.000Z',
    volume5mUsd: 600_000,
  })

  it('quiet accumulation: supply leaving on real flow, price flat', () => {
    const out = classifyAccumulation([
      reading({ ...base(), devPercent: 4, sniperPercent: 7, bundlerPercent: 12, insiderPercent: 5, top10Percent: 35, marketCapUsd: 1_000_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', devPercent: 0.5, sniperPercent: 2, bundlerPercent: 6, insiderPercent: 2, top10Percent: 20, marketCapUsd: 1_020_000, volume5mUsd: 612_000 }),
    ])
    expect(out.verdict).toBe('ACCUMULATION')
    expect(out.score).toBeGreaterThan(50)
    expect(out.evidence.some((e) => e.includes('dev: supply leaving 4% → 0.5%'))).toBe(true)
    expect(out.evidence.some((e) => e.includes('price quiet'))).toBe(true)
  })

  it('churn: real flow but concentration rising', () => {
    const out = classifyAccumulation([
      reading({ ...base(), sniperPercent: 2, top10Percent: 20, marketCapUsd: 1_000_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', sniperPercent: 8, top10Percent: 34, marketCapUsd: 1_050_000 }),
    ])
    expect(out.verdict).toBe('CHURN')
  })

  it('distribution: supply entering on thin flow', () => {
    const out = classifyAccumulation([
      reading({ ...base(), sniperPercent: 1, top10Percent: 18, volume5mUsd: 100_000, marketCapUsd: 1_000_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', sniperPercent: 5, top10Percent: 24, volume5mUsd: 100_000, marketCapUsd: 1_000_000 }),
    ])
    expect(out.verdict).toBe('DISTRIBUTION')
  })

  it('flags liquidity draining on an otherwise clean read', () => {
    const out = classifyAccumulation([
      reading({ ...base(), marketCapUsd: 1_000_000, liquidityUsd: 100_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', marketCapUsd: 1_000_000, liquidityUsd: 60_000 }),
    ])
    expect(out.evidence.some((e) => e.includes('liquidity draining'))).toBe(true)
  })

  it('treats a >10% mcap move as no longer quiet', () => {
    const out = classifyAccumulation([
      reading({ ...base(), marketCapUsd: 1_000_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', marketCapUsd: 1_300_000 }),
    ])
    expect(out.evidence.some((e) => e.includes('price moved'))).toBe(true)
  })

  it('cluster unwinding adds evidence', () => {
    const out = classifyAccumulation([
      reading({ ...base(), clusterPercent: 4 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', clusterPercent: 0.2 }),
    ])
    expect(out.evidence.some((e) => e.includes('cluster: unwinding'))).toBe(true)
  })

  it('ignores sub-threshold noise (0.2pt is not an exit)', () => {
    const out = classifyAccumulation([
      reading({ ...base(), sniperPercent: 2, marketCapUsd: 1_000_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', sniperPercent: 1.8, marketCapUsd: 1_000_000, volume5mUsd: 100_000 }),
    ])
    expect(out.evidence.some((e) => e.includes('sniper: supply leaving'))).toBe(false)
    expect(out.verdict).toBe('UNKNOWN')
  })

  it('score never exceeds 100 and never goes below 0', () => {
    const high = classifyAccumulation([
      reading({ devPercent: 20, sniperPercent: 20, bundlerPercent: 30, insiderPercent: 20, top10Percent: 90, clusterPercent: 10, marketCapUsd: 1_000_000, volume5mUsd: 900_000 }),
      reading({ at: '2026-10-12T01:00:00.000Z', devPercent: 0, sniperPercent: 0, bundlerPercent: 0, insiderPercent: 0, top10Percent: 10, clusterPercent: 0, marketCapUsd: 1_000_000, volume5mUsd: 900_000, liquidityUsd: 50_000 }),
    ])
    expect(high.score).toBeLessThanOrEqual(100)
    expect(high.score).toBeGreaterThan(0)
  })

  it('readings must be oldest-first — uses first and last', () => {
    const out = classifyAccumulation([
      reading({ at: '2026-10-12T00:00:00.000Z', sniperPercent: 8 }),
      reading({ at: '2026-10-12T00:30:00.000Z', sniperPercent: 4 }),
      reading({ at: '2026-10-12T01:00:00.000Z', sniperPercent: 1 }),
    ])
    expect(out.readings).toBe(3)
    expect(out.evidence.some((e) => e.includes('8% → 1%'))).toBe(true)
  })

  it('config threshold is honored, not hardcoded', () => {
    const pair: [AccumulationReading, AccumulationReading] = [
      reading({ sniperPercent: 2, marketCapUsd: 1_000_000, volume5mUsd: 100_000 }),
      reading({ at: '2026-10-12T01:00:00.000Z', sniperPercent: 1.6, marketCapUsd: 1_000_000, volume5mUsd: 100_000 }),
    ]
    const strict = classifyAccumulation(pair, { ...ACCUMULATION_DEFAULTS, minTierExitPct: 1 })
    const loose = classifyAccumulation(pair, { ...ACCUMULATION_DEFAULTS, minTierExitPct: 0.2 })
    expect(strict.evidence.some((e) => e.includes('sniper: supply leaving'))).toBe(false)
    expect(loose.evidence.some((e) => e.includes('sniper: supply leaving'))).toBe(true)
  })

  it('supports the magazine claim: 15 straight readings stay deterministic', () => {
    const series: AccumulationReading[] = Array.from({ length: 15 }, (_, i) =>
      reading({
        at: `2026-10-12T${String(i).padStart(2, '0')}:00:00.000Z`,
        sniperPercent: Math.max(0, 8 - i * 0.5),
        marketCapUsd: 1_000_000,
        volume5mUsd: 600_000,
      }),
    )
    const out = classifyAccumulation(series)
    expect(out.readings).toBe(15)
    expect(out.verdict).toBe('ACCUMULATION')
  })

  it('flat market with no movement is UNKNOWN, not accumulation', () => {
    const out = classifyAccumulation([reading(), { ...reading(), at: '2026-10-12T01:00:00.000Z' }])
    expect(out.verdict).toBe('UNKNOWN')
  })

  it('the taped fixture holds: whale sell plus whale buy on opposite tapes', () => {
    // Two readings, whale dumps 6pt while a second tier accumulates 6pt.
    const out = classifyAccumulation([
      reading({ ...base(), sniperPercent: 9, insiderPercent: 2, top10Percent: 30, volume5mUsd: 600_000, marketCapUsd: 1_000_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', sniperPercent: 3, insiderPercent: 8, top10Percent: 30, volume5mUsd: 600_000, marketCapUsd: 1_000_000 }),
    ])
    expect(out.evidence.some((e) => e.includes('sniper: supply leaving 9% → 3%'))).toBe(true)
    expect(out.evidence.some((e) => e.includes('insider: supply entering 2% → 8%'))).toBe(true)
  })

  it('a one-sided whale buy with no offset is not called accumulation', () => {
    const out = classifyAccumulation([
      reading({ ...base(), top10Percent: 18, volume5mUsd: 100_000, marketCapUsd: 1_000_000 }),
      reading({ ...base(), at: '2026-10-12T01:00:00.000Z', top10Percent: 30, volume5mUsd: 600_000, marketCapUsd: 1_000_000 }),
    ])
    expect(out.verdict === 'ACCUMULATION').toBe(false)
  })
})
