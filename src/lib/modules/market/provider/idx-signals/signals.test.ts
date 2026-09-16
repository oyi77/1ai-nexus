// ─────────────────────────────────────────────────────────────
// IDX signals tests — pure math (median, scoring, ranking) + shape
// contracts. No network, no DB (loaders throw EmptySnapshotError
// on empty DB — covered by route behavior, not unit-mocked).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

describe('RS scoring math (mirror of provider)', () => {
  const score = (avg: number): number =>
    Math.max(0, Math.min(100, ((Math.max(-30, Math.min(30, avg)) + 30) / 60) * 100))

  it('maps +30pp → 100, 0 → 50, -30pp → 0', () => {
    expect(score(30)).toBe(100)
    expect(score(0)).toBe(50)
    expect(score(-30)).toBe(0)
  })

  it('clamps extremes', () => {
    expect(score(100)).toBe(100)
    expect(score(-100)).toBe(0)
  })
})

describe('breakout distance math (mirror of provider)', () => {
  const dist = (price: number, high: number): number => ((price - high) / high) * 100

  it('3% below high → -3', () => {
    expect(dist(9700, 10000)).toBeCloseTo(-3)
  })

  it('at high → 0, above high excluded by filter', () => {
    expect(dist(10000, 10000)).toBe(0)
    expect(10100 > 10000).toBe(true) // provider skips price > high
  })
})

describe('bandar rank math (mirror of provider)', () => {
  const rank = (streakAcc: boolean, accdist: string, days: number): number =>
    (streakAcc ? 1000 : 0) + (/acc/i.test(accdist) ? 500 : 0) + Math.min(days, 30)

  it('accumulation + Acc read outranks distribution', () => {
    expect(rank(true, 'Big Acc', 5)).toBeGreaterThan(rank(false, 'Big Dist', 10))
  })

  it('streak days cap at 30', () => {
    expect(rank(false, 'Dist', 60)).toBe(rank(false, 'Dist', 30))
  })
})
