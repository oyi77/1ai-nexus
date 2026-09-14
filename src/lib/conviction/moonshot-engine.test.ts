import { describe, expect, it } from 'vitest'
import { computeMoonshot, type MoonshotInput } from '@/lib/conviction/moonshot-engine'
function sessions(n: number, close0: number, close1: number, vol0: number, volLast: number, highMax: number): MoonshotInput['sessions'] {
  const out: MoonshotInput['sessions'] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1)
    const close = close0 + (close1 - close0) * t
    // Cap intrabar highs at highMax so the trailing-high anchor is deterministic.
    const high = i === Math.floor(n / 2) ? highMax : Math.min(close * 1.01, highMax * 0.99)
    out.push({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      close,
      high,
      low: close * 0.99,
      volume: i === n - 1 ? volLast : vol0,
    })
  }
  return out
}

const BASE_SCREENER = {
  change4w: 15, change13w: 20, change26w: 25, change52w: 30,
  price: 85, high52w: 100, marketCap: 5e11,
}

describe('computeMoonshot', () => {
  it('returns pass with no session history', () => {
    const r = computeMoonshot({ sessions: [], screener: BASE_SCREENER, sector: 'Energy' })
    expect(r.verdict).toBe('pass')
    expect(r.totalScore).toBe(50)
  })

  it('flags a perfect runner setup as moonshot', () => {
    const r = computeMoonshot({
      sessions: sessions(21, 100, 120, 1000, 2500, 100),
      screener: BASE_SCREENER,
      sector: 'Consumer Cyclicals',
    })
    expect(r.verdict).toBe('moonshot')
    expect(r.totalScore).toBeGreaterThanOrEqual(78)
    expect(r.components.momentum.score).toBe(90)
    expect(r.components.ignition.score).toBe(80)
    expect(r.components.position.score).toBe(80)
    expect(r.components.size.score).toBe(80)
  })

  it('lands a mixed setup in watch band', () => {
    const r = computeMoonshot({
      sessions: sessions(21, 100, 104, 1000, 3500, 100),
      screener: { change4w: 5, change13w: -2, change26w: 3, change52w: -1, price: 92, high52w: 100, marketCap: 5e12 },
      sector: 'Technology',
    })
    expect(r.verdict).toBe('watch')
    expect(r.totalScore).toBeGreaterThanOrEqual(60)
    expect(r.totalScore).toBeLessThan(78)
  })

  it('rejects downtrend + big cap + cold sector as pass', () => {
    const r = computeMoonshot({
      sessions: sessions(21, 120, 100, 1000, 500, 100),
      screener: { change4w: -8, change13w: -12, change26w: -15, change52w: -20, price: 99, high52w: 100, marketCap: 5e13 },
      sector: 'Financials',
    })
    expect(r.verdict).toBe('pass')
    expect(r.components.momentum.score).toBe(25)
    expect(r.components.size.score).toBe(30)
    expect(r.components.sector.score).toBe(35)
  })

  it('penalizes chasing at the high vs pullback zone', () => {
    const mk = (price: number) =>
      computeMoonshot({
        sessions: sessions(21, 100, 120, 1000, 2500, 100),
        screener: { ...BASE_SCREENER, price },
        sector: 'Energy',
      })
    expect(mk(85).components.position.score).toBe(80)
    expect(mk(99).components.position.score).toBe(40)
  })

  it('applies the dead-flat guard to ignition', () => {
    const flat = sessions(21, 100, 100.2, 1000, 2500, 100)
    const lively = sessions(21, 100, 120, 1000, 2500, 100)
    const rf = computeMoonshot({ sessions: flat, screener: BASE_SCREENER, sector: 'Energy' })
    const rl = computeMoonshot({ sessions: lively, screener: BASE_SCREENER, sector: 'Energy' })
    expect(rf.components.ignition.score).toBeLessThan(rl.components.ignition.score)
    expect(rf.components.ignition.reasons.some((x) => x.text.includes('Flat base'))).toBe(true)
  })

  it('labels single-timeframe momentum as short history, not "all 1"', () => {
    const r = computeMoonshot({
      sessions: sessions(21, 100, 120, 1000, 2500, 100),
      screener: { change4w: 15, change13w: null, change26w: null, change52w: null, price: 85, high52w: 100, marketCap: 5e11 },
      sector: 'Energy',
    })
    expect(r.components.momentum.reasons.some((x) => x.text.includes('short history'))).toBe(true)
    expect(r.components.momentum.reasons.some((x) => x.text.includes('all 1'))).toBe(false)
  })
})
