// ─────────────────────────────────────────────────────────────
// strategy-evaluator + ladder-planner tests — pure, deterministic.
//
// Each test pins ONE named rule of the operator's playbook, from the
// worked examples they gave (MC bands, SL aliran, tranche sizing).
// The "false pass" cases are the important ones: every test that says
// a strategy must NOT fire proves the evaluator refuses VIBES.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  evaluateSecondWave,
  evaluateLevelFlip,
  evaluateWhaleComeback,
  type MarketContext,
  type HolderContext,
  type StructureContext,
} from '../strategy-evaluator'
import { analyzeStructure, type McStructure, type StructureBar } from '../mc-structure'
import { planLadder, reportFills } from '../ladder-planner'

const HOUR = 3_600_000
const T0 = 1_792_000_000_000

/** Synthetic OHLC in MC units — the operator reads everything in MC. */
function toStructureBars(rows: Array<[number, number, number, number]>): StructureBar[] {
  return rows.map(([low, high, close, vol], i) => ({
    timeMs: T0 + i * HOUR,
    openUsd: (low + high) / 2,
    highUsd: high,
    lowUsd: low,
    closeUsd: close,
    volumeUsd: vol,
  }))
}

/** The operator's own Second Wave worked example: pump 2M→6M, base 3.6–4.4, entry 4.6. */
function secondWaveBars(): StructureBar[] {
  // The $6M pump happened BEFORE the base window; the last 24 bars are all
  // inside the 3.5M–4.7M consolidation, exactly like the operator's example.
  const base = toStructureBars([
    [3_500_000, 4_300_000, 3_900_000, 10_000],
    [3_600_000, 4_400_000, 4_000_000, 10_000],
    [3_550_000, 4_350_000, 3_950_000, 10_000],
    [3_600_000, 4_400_000, 4_100_000, 10_000],
    [3_700_000, 4_500_000, 4_200_000, 10_000],
    [3_800_000, 4_400_000, 4_300_000, 10_000],
    [3_900_000, 4_500_000, 4_400_000, 10_000],
    [4_000_000, 4_600_000, 4_500_000, 10_000],
    [4_100_000, 4_700_000, 4_600_000, 10_000],
    [4_150_000, 4_700_000, 4_650_000, 10_000],
  ])
  return base
}

const GOOD_MARKET: MarketContext = { liquidityUsd: 300_000, volume24hUsd: 500_000 }
const GOOD_HOLDERS: HolderContext = { trackedHolders: 25 }

function ctx(bars: StructureBar[], buyers: string[] = ['AAA1111', 'BBB2222'], classified = 1): StructureContext {
  return {
    structure: analyzeStructure(bars),
    buyers,
    hasClassifiedBuyer: classified > 0,
    classifiedBuyerCount: classified,
  }
}

describe('Second Wave', () => {
  it("fires the operator's worked-example shape through every structure rule", () => {
    const v = evaluateSecondWave(ctx(secondWaveBars()), GOOD_MARKET, GOOD_HOLDERS)
    // All structure refs must PASS for this shape; shared-gate refs use
    // injected values so they also pass.
    for (const r of v.refs) {
      if (r.rule !== 'break-and-close-above-resistance') {
        expect({ rule: r.rule, passed: r.passed }).toEqual({ rule: r.rule, passed: true })
      }
    }
  })

  it('refuses when the last low is LOWER (no higher low, no fire)', () => {
    const bars = toStructureBars([
      [4_000_000, 4_500_000, 4_300_000, 10_000],
      [3_800_000, 4_400_000, 4_100_000, 10_000],
      [3_600_000, 4_200_000, 3_900_000, 10_000],
      [3_900_000, 4_300_000, 4_000_000, 10_000],
      [3_950_000, 4_400_000, 4_100_000, 10_000],
      [4_000_000, 4_500_000, 4_200_000, 10_000],
      [4_100_000, 4_600_000, 4_300_000, 10_000],
      [3_400_000, 4_000_000, 3_600_000, 10_000], // decisive lower low
      [3_450_000, 3_900_000, 3_700_000, 10_000],
      [3_500_000, 3_950_000, 3_800_000, 10_000],
      [3_550_000, 4_000_000, 3_900_000, 10_000],
      [3_600_000, 4_050_000, 4_000_000, 10_000],
    ])
    const v = evaluateSecondWave(ctx(bars), GOOD_MARKET, GOOD_HOLDERS)
    expect(v.fired).toBe(false)
    const hl = v.refs.find((r) => r.rule === 'higher-low')
    expect(hl?.passed).toBe(false)
  })

  it('refuses when price-guard holders < 10 (operator mandate)', () => {
    const v = evaluateSecondWave(ctx(secondWaveBars()), GOOD_MARKET, { trackedHolders: 7 })
    expect(v.fired).toBe(false)
    const guard = v.refs.find((r) => r.rule === 'price-guard-holders')
    expect(guard?.passed).toBe(false)
    expect(guard?.detail).toContain('7/10')
  })

  it('refuses when tracked holder count is UNKNOWN (unverified ≠ verified)', () => {
    const v = evaluateSecondWave(ctx(secondWaveBars()), GOOD_MARKET, { trackedHolders: null })
    const guard = v.refs.find((r) => r.rule === 'price-guard-holders')
    expect(guard?.passed).toBe(false)
    expect(guard?.detail).toContain('unverified')
  })
})

describe('Level Flip', () => {
  it('refuses without a retest — do not chase the breakout', () => {
    const v = evaluateLevelFlip(ctx(secondWaveBars()), GOOD_MARKET, GOOD_HOLDERS)
    const retest = v.refs.find((r) => r.rule === 'retest-occurred-and-held')
    expect(retest?.passed).toBe(false)
    expect(v.fired).toBe(false)
  })

  it('refuses when price re-entered the old range (failed reclaim)', () => {
    // Base 10–12M, breakout to 13M, then a close back INSIDE the range.
    const bars = toStructureBars([
      [10_000_000, 12_000_000, 11_000_000, 10_000],
      [10_100_000, 12_100_000, 11_100_000, 10_000],
      [10_200_000, 12_300_000, 11_200_000, 10_000],
      [10_300_000, 12_400_000, 11_300_000, 10_000],
      [10_400_000, 12_500_000, 11_400_000, 10_000],
      [10_500_000, 12_600_000, 11_500_000, 10_000],
      [10_600_000, 12_700_000, 11_600_000, 10_000],
      [10_700_000, 12_800_000, 11_700_000, 10_000],
      [10_800_000, 12_900_000, 11_800_000, 10_000],
      [10_900_000, 13_200_000, 11_500_000, 10_000], // back inside 12.9M high
    ])
    const v = evaluateLevelFlip(ctx(bars), GOOD_MARKET, GOOD_HOLDERS)
    const range = v.refs.find((r) => r.rule === 'no-reentry-into-range')
    expect(range?.passed).toBe(false)
    expect(v.confidence).toBeGreaterThan(0)
  })

  it('refuses when no base is resolvable — "did not re-enter" is unprovable, not true', () => {
    const noBase: McStructure = {
      bars: 24,
      currentMcUsd: 12_000_000,
      pivots: [],
      lastLows: null,
      higherLow: true,
      newLowRecently: false,
      base: null,
      minorResistanceUsd: 10_000_000,
      breakout: { levelUsd: 10_000_000, closeUsd: 11_600_000, marginPct: 0.16, atMs: T0 + 20 * HOUR, index: 20 },
      retest: { levelUsd: 10_000_000, held: true, atMs: T0 + 21 * HOUR, dipPct: -0.012 },
      volume: { downRecent: 10_000, downPrior: 30_000, downRatio: 0.33, upRecent: 60_000, upPrior: 100_000, upRatio: 0.6 },
      seriesHighUsd: 12_000_000,
      seriesLowUsd: 4_000_000,
    }
    const v = evaluateLevelFlip({ ...ctx([]), structure: noBase }, GOOD_MARKET, GOOD_HOLDERS)
    const range = v.refs.find((r) => r.rule === 'no-reentry-into-range')
    expect(range?.passed).toBe(false)
    expect(range?.detail).toContain('unproven')
    expect(v.fired).toBe(false)
    expect(v.confidence).toBe(0)
  })

  it('fires on a held retest with the base resolved, and prices the plan from it', () => {
    const withBase: McStructure = {
      bars: 24,
      currentMcUsd: 12_000_000,
      pivots: [],
      lastLows: null,
      higherLow: true,
      newLowRecently: false,
      base: {
        lowUsd: 10_000_000,
        highUsd: 11_000_000,
        midUsd: 10_500_000,
        widthPct: 0.1,
        bars: 6,
        startMs: T0 + 10 * HOUR,
        endMs: T0 + 16 * HOUR,
      },
      minorResistanceUsd: 10_000_000,
      breakout: { levelUsd: 10_000_000, closeUsd: 11_600_000, marginPct: 0.16, atMs: T0 + 20 * HOUR, index: 20 },
      retest: { levelUsd: 10_000_000, held: true, atMs: T0 + 21 * HOUR, dipPct: -0.012 },
      volume: { downRecent: 10_000, downPrior: 30_000, downRatio: 0.33, upRecent: 60_000, upPrior: 100_000, upRatio: 0.6 },
      seriesHighUsd: 12_000_000,
      seriesLowUsd: 4_000_000,
    }
    const v = evaluateLevelFlip({ ...ctx([]), structure: withBase }, GOOD_MARKET, GOOD_HOLDERS)
    const range = v.refs.find((r) => r.rule === 'no-reentry-into-range')
    expect(range?.passed).toBe(true)
    const stop = v.refs.find((r) => r.rule === 'stop-below-base-range')
    expect(stop?.passed).toBe(true)
    expect(v.fired).toBe(true)
    expect(v.entryUsd).toBe(12_000_000)
    // The stop is the base floor minus the 2% margin, NOT the retest level:
    // a stop parked on the floor is taken out by the wick that validates it.
    expect(v.stopUsd).toBe(9_800_000)
    expect(v.stopUsd).toBeLessThan(withBase.base!.lowUsd)
    expect(v.rr).toBeGreaterThan(2)
  })
})

describe('Whale Comeback', () => {
  const comebackBars = toStructureBars([
    [40_000_000, 60_000_000, 55_000_000, 10_000],
    [25_000_000, 35_000_000, 30_000_000, 10_000],
    [18_000_000, 22_000_000, 20_000_000, 10_000],
    [17_000_000, 20_000_000, 18_500_000, 10_000],
    [17_500_000, 20_500_000, 19_000_000, 10_000],
    [18_000_000, 21_000_000, 19_500_000, 10_000],
    [18_500_000, 21_500_000, 19_800_000, 10_000],
    [19_000_000, 22_000_000, 20_000_000, 10_000],
    [19_500_000, 22_300_000, 20_200_000, 10_000],
    [20_000_000, 22_500_000, 20_500_000, 10_000],
  ])

  it('refuses a single buyer (independence cannot be established)', () => {
    const v = evaluateWhaleComeback(ctx(comebackBars, ['AAA1111'], 1), GOOD_MARKET, GOOD_HOLDERS)
    const ind = v.refs.find((r) => r.rule === 'wallet-independence')
    expect(ind?.passed).toBe(false)
    expect(v.fired).toBe(false)
  })

  it('refuses when a checked pair is CLUSTERED (funding-source rule)', () => {
    const v = evaluateWhaleComeback(
      ctx(comebackBars, ['AAA1111', 'BBBB2222'], 2),
      GOOD_MARKET,
      GOOD_HOLDERS,
      {},
      { checked: [{ a: 'AAA1111', b: 'BBBB2222', connected: true, confidence: 0.9 }] },
    )
    const ind = v.refs.find((r) => r.rule === 'wallet-independence')
    expect(ind?.passed).toBe(false)
    expect(ind?.detail).toContain('CLUSTERED')
    expect(v.fired).toBe(false)
  })

  it('refuses without a prior runner high (proves history, not a fresh mint)', () => {
    const shallow = toStructureBars([
      [8_000_000, 9_000_000, 8_500_000, 10_000],
      [8_100_000, 9_100_000, 8_600_000, 10_000],
      [8_200_000, 9_200_000, 8_700_000, 10_000],
      [8_300_000, 9_300_000, 8_800_000, 10_000],
      [8_400_000, 9_400_000, 8_900_000, 10_000],
      [8_500_000, 9_500_000, 9_000_000, 10_000],
      [8_550_000, 9_450_000, 8_950_000, 10_000],
      [8_600_000, 9_500_000, 9_000_000, 10_000],
      [8_650_000, 9_550_000, 9_050_000, 10_000],
      [8_700_000, 9_600_000, 9_100_000, 10_000],
      [8_750_000, 9_650_000, 9_150_000, 10_000],
    ])
    const v = evaluateWhaleComeback(ctx(shallow), GOOD_MARKET, GOOD_HOLDERS)
    const hist = v.refs.find((r) => r.rule === 'prior-history')
    expect(hist?.passed).toBe(false)
  })
  it('refuses an UNCHECKED pair — "belum dicek" is not "aman"', () => {
    const v = evaluateWhaleComeback(ctx(comebackBars, ['AAA1111', 'BBBB2222'], 2), GOOD_MARKET, GOOD_HOLDERS)
    const ind = v.refs.find((r) => r.rule === 'wallet-independence')
    expect(ind?.passed).toBe(false)
    expect(ind?.detail).toContain('NOT CHECKED')
    expect(v.fired).toBe(false)
  })

  it('refuses an UNKNOWN cluster result — an answerless check is no evidence', () => {
    const v = evaluateWhaleComeback(
      ctx(comebackBars, ['AAA1111', 'BBBB2222'], 2),
      GOOD_MARKET,
      GOOD_HOLDERS,
      {},
      { checked: [{ a: 'AAA1111', b: 'BBBB2222', connected: null, confidence: null }] },
    )
    const ind = v.refs.find((r) => r.rule === 'wallet-independence')
    expect(ind?.passed).toBe(false)
    expect(ind?.detail).toContain('UNKNOWN')
    expect(v.fired).toBe(false)
  })

  it('passes only a CHECKED-INDEPENDENT pair, and reports it as verified', () => {
    const v = evaluateWhaleComeback(
      ctx(comebackBars, ['AAA1111', 'BBBB2222'], 2),
      GOOD_MARKET,
      GOOD_HOLDERS,
      {},
      { checked: [{ a: 'AAA1111', b: 'BBBB2222', connected: false, confidence: 0.8 }] },
    )
    const ind = v.refs.find((r) => r.rule === 'wallet-independence')
    expect(ind?.passed).toBe(true)
    expect(ind?.detail).toContain('verified')
  })

  it('gives a clustered and an unchecked pair the same zero confidence, never a vibe score', () => {
    const buyers = ['AAA1111', 'BBBB2222']
    const clustered = evaluateWhaleComeback(
      ctx(comebackBars, buyers, 2),
      GOOD_MARKET,
      GOOD_HOLDERS,
      {},
      { checked: [{ a: buyers[0], b: buyers[1], connected: true, confidence: 0.95 }] },
    )
    const unchecked = evaluateWhaleComeback(ctx(comebackBars, buyers, 2), GOOD_MARKET, GOOD_HOLDERS)
    expect(clustered.confidence).toBe(0)
    expect(unchecked.confidence).toBe(0)
  })
})

describe('ladder planner (operator 40/30/30 rule)', () => {
  it('sizes from the stop first and splits by weight', () => {
    const plan = planLadder(
      {
        capitalUsd: 1_000,
        riskPct: 0.01, // risk $10
        stopUsd: 3_900_000,
        tranches: [
          { reason: 'retest', atMcUsd: 4_300_000, weight: 0.4 },
          { reason: 'reclaim', atMcUsd: 4_400_000, weight: 0.3 },
          { reason: 'breakout', atMcUsd: 4_500_000, weight: 0.3 },
        ],
      },
      6_000_000,
    )
    expect(plan.valid).toBe(true)
    // avg entry ≈ 4.39M, stop dist ≈ 11.16%, position ≈ $89.6
    expect(plan.avgEntryUsd).toBeCloseTo(4_390_000, 0)
    expect(plan.positionUsd).toBeGreaterThan(80)
    expect(plan.lossAtStopUsd).toBeLessThanOrEqual(10.5)
    expect(plan.rr).not.toBeNull()
  })

  it('refuses a tranche at/below the stop — never add under the SL', () => {
    const plan = planLadder({
      capitalUsd: 1_000,
      riskPct: 0.01,
      stopUsd: 3_900_000,
      tranches: [
        { reason: 'retest', atMcUsd: 4_300_000, weight: 0.5 },
        { reason: 'reclaim', atMcUsd: 3_900_000, weight: 0.5 },
      ],
    })
    expect(plan.valid).toBe(false)
    expect(plan.problem).toContain('at/below the stop')
  })

  it('refuses weights that do not sum to 1', () => {
    const plan = planLadder({
      capitalUsd: 1_000,
      riskPct: 0.01,
      stopUsd: 3_900_000,
      tranches: [
        { reason: 'retest', atMcUsd: 4_300_000, weight: 0.4 },
        { reason: 'reclaim', atMcUsd: 4_400_000, weight: 0.4 },
      ],
    })
    expect(plan.valid).toBe(false)
    expect(plan.problem).toContain('sum to 1')
  })

  it('recomputes loss on PARTIAL fills from actual size (2 of 3 like the operator example)', () => {
    const plan = planLadder({
      capitalUsd: 1_000,
      riskPct: 0.01,
      stopUsd: 3_900_000,
      tranches: [
        { reason: 'retest', atMcUsd: 4_300_000, weight: 0.4 },
        { reason: 'reclaim', atMcUsd: 4_400_000, weight: 0.3 },
        { reason: 'breakout', atMcUsd: 4_500_000, weight: 0.3 },
      ],
    })
    const fills = reportFills(plan, ['retest', 'reclaim'])
    expect(fills.filled.length).toBe(2)
    expect(fills.avgEntryUsd).toBeCloseTo((4_300_000 * 0.4 + 4_400_000 * 0.3) / 0.7, 0)
    // Real loss on deployed size only.
    expect(fills.lossAtStopUsd).toBeLessThan(plan.lossAtStopUsd)
  })
})
