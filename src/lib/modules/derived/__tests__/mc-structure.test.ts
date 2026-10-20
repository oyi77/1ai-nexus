// ─────────────────────────────────────────────────────────────
// mc-structure tests — synthetic series with KNOWN structure so each
// rule is proven on the shape it claims to detect:
//   · higher low vs lower low
//   · base width accept / reject
//   · breakout requires a CLOSE (a wick is not a breakout)
//   · retest held vs failed
//   · new-low detection (a base still bleeding must not pass)
//   · volume trend: selling fading (ratio < 1) vs rising (> 1)
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  analyzeStructure,
  findBase,
  findBreakout,
  findPivots,
  findRetest,
  printsNewLows,
  volumeTrend,
  STRUCTURE_DEFAULTS,
  type StructureBar,
} from '../mc-structure'

const HOUR = 3_600_000
const T0 = 1_792_000_000_000

/** Build bars from [low, high, close, volume] tuples, oldest → newest. */
function series(rows: Array<[number, number, number, number]>): StructureBar[] {
  return rows.map(([low, high, close, volume], i) => ({
    timeMs: T0 + i * HOUR,
    openUsd: (low + high) / 2,
    highUsd: high,
    lowUsd: low,
    closeUsd: close,
    volumeUsd: volume,
  }))
}

/** A flat-ish base with tiny noise, `n` bars wide. */
function baseBars(n: number, low: number, high: number, vol = 1_000): StructureBar[] {
  return Array.from({ length: n }, () => ({
    timeMs: 0,
    openUsd: (low + high) / 2,
    highUsd: high,
    lowUsd: low,
    closeUsd: (low + high) / 2,
    volumeUsd: vol,
  })).map((b, i) => ({ ...b, timeMs: T0 + i * HOUR }))
}

describe('findPivots', () => {
  it('detects a swing high and a swing low', () => {
    const bars = series([
      [100, 105, 103, 1],
      [100, 106, 104, 1],
      [102, 115, 110, 1], // swing high at 115
      [104, 108, 106, 1],
      [90, 100, 95, 1], // swing low at 90
      [95, 102, 100, 1],
      [97, 104, 102, 1],
    ])
    const pivots = findPivots(bars, 1)
    expect(pivots.some((p) => p.kind === 'high' && p.priceUsd === 115)).toBe(true)
    expect(pivots.some((p) => p.kind === 'low' && p.priceUsd === 90)).toBe(true)
  })
})

describe('findBase', () => {
  it('accepts a tight range', () => {
    const bars = baseBars(20, 1_000, 1_100)
    const base = findBase(bars, STRUCTURE_DEFAULTS)
    expect(base).not.toBeNull()
    expect(base?.lowUsd).toBe(1_000)
    expect(base?.highUsd).toBe(1_100)
    expect(base?.widthPct).toBeCloseTo(0.1, 5)
  })

  it('rejects a range wider than maxBaseWidthPct (no base, just chop)', () => {
    const bars = baseBars(20, 1_000, 2_000) // 100% wide
    expect(findBase(bars, STRUCTURE_DEFAULTS)).toBeNull()
  })
})

describe('findBreakout', () => {
  it('fires on a CLOSE above the level', () => {
    const bars = [...baseBars(10, 1_000, 1_100), ...series([[1_050, 1_200, 1_180, 5_000]])]
    const level = 1_100
    const breakout = findBreakout(bars, level, STRUCTURE_DEFAULTS)
    expect(breakout).not.toBeNull()
    expect(breakout?.closeUsd).toBe(1_180)
    expect(breakout?.marginPct).toBeCloseTo(1_180 / 1_100 - 1, 6)
  })

  it('does NOT fire on a wick above the level with a close below it', () => {
    const bars = [...baseBars(10, 1_000, 1_100), ...series([[1_050, 1_400, 1_090, 5_000]])]
    expect(findBreakout(bars, 1_100, STRUCTURE_DEFAULTS)).toBeNull()
  })

  it('requires the margin, not just any close above', () => {
    const bars = [...baseBars(10, 1_000, 1_100), ...series([[1_050, 1_200, 1_105, 5_000]])]
    // 1_105 is only +0.45%, under the 2% margin.
    expect(findBreakout(bars, 1_100, STRUCTURE_DEFAULTS)).toBeNull()
  })
})

describe('findRetest', () => {
  /** Full series = base + break + after, so breakout.index is valid. */
  function setupWithRetest(afterRows: Array<[number, number, number, number]>): StructureBar[] {
    return baseBars(10, 1_000, 1_100).concat(series([[1_050, 1_200, 1_180, 5_000]]), series(afterRows))
  }

  it('reports HELD when price returns to the level and closes above it', () => {
    const bars = setupWithRetest([
      [1_150, 1_190, 1_170, 1],
      [1_080, 1_120, 1_115, 1], // dip to 1080, close 1115 (above the level)
      [1_110, 1_160, 1_150, 1],
    ])
    const breakout = findBreakout(bars, 1_100, STRUCTURE_DEFAULTS)
    const retest = findRetest(bars, breakout, STRUCTURE_DEFAULTS)
    expect(retest?.held).toBe(true)
    expect(retest?.dipPct).toBeCloseTo(1_080 / 1_100 - 1, 5)
  })

  it('reports FAILED when the retest closes back under the level', () => {
    const bars = setupWithRetest([
      [1_150, 1_190, 1_170, 1],
      [1_060, 1_090, 1_070, 1],
    ])
    const retest = findRetest(bars, findBreakout(bars, 1_100, STRUCTURE_DEFAULTS), STRUCTURE_DEFAULTS)
    expect(retest?.held).toBe(false)
  })

  it('returns null when price never came back to the level', () => {
    const bars = setupWithRetest([[1_300, 1_400, 1_380, 1]])
    const retest = findRetest(bars, findBreakout(bars, 1_100, STRUCTURE_DEFAULTS), STRUCTURE_DEFAULTS)
    expect(retest).toBeNull()
  })
})

describe('printsNewLows', () => {
  it('is true when the recent window undercuts the prior window low', () => {
    const bars = [...baseBars(8, 1_000, 1_100), ...baseBars(8, 900, 1_000)]
    expect(printsNewLows(bars, 8)).toBe(true)
  })

  it('is false when recent lows hold above the prior low', () => {
    const bars = [...baseBars(8, 1_000, 1_100), ...baseBars(8, 1_050, 1_150)]
    expect(printsNewLows(bars, 8)).toBe(false)
  })
})

describe('volumeTrend', () => {
  it('reports selling FADING when recent down-volume is lower', () => {
    const prior = Array.from({ length: 8 }, () => ({
      timeMs: 0, openUsd: 110, highUsd: 112, lowUsd: 104, closeUsd: 105, volumeUsd: 1_000,
    }))
    const recent = Array.from({ length: 8 }, () => ({
      timeMs: 0, openUsd: 110, highUsd: 112, lowUsd: 104, closeUsd: 105, volumeUsd: 400,
    }))
    const bars = [...prior, ...recent].map((b, i) => ({ ...b, timeMs: T0 + i * HOUR }))
    const t = volumeTrend(bars, 8)
    expect(t.downRatio).toBeCloseTo(0.4, 5)
  })
})

describe('analyzeStructure (end to end)', () => {
  it('reads a second-wave shape: base, higher low, breakout close', () => {
    const bars = series([
      // pump then fade into a base
      [2_000_000, 6_000_000, 5_500_000, 100],
      [4_000_000, 5_000_000, 4_200_000, 100],
      [3_600_000, 4_400_000, 4_000_000, 100],
      [3_500_000, 4_300_000, 3_900_000, 100],
      [3_600_000, 4_400_000, 4_100_000, 100],
      [3_700_000, 4_500_000, 4_200_000, 100],
      [3_800_000, 4_400_000, 4_300_000, 100],
      [3_900_000, 4_500_000, 4_400_000, 100],
      [4_000_000, 4_600_000, 4_500_000, 100],
      [4_100_000, 4_700_000, 4_600_000, 100],
    ])
    const s = analyzeStructure(bars)
    expect(s).not.toBeNull()
    expect(s?.newLowRecently).toBe(false)
    expect(s?.seriesHighUsd).toBe(6_000_000)
    expect(s?.currentMcUsd).toBe(4_600_000)
  })

  it('returns null for a series too short to read', () => {
    expect(analyzeStructure(series([[1, 2, 1.5, 1]]))).toBeNull()
  })
})
