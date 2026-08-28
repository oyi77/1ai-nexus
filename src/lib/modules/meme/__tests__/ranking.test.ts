// ─────────────────────────────────────────────────────────────
// Meme-Alpha ranking + gamification-tier unit tests (no network).
// Provides the fixture-backed receipt for sortByMetrics (route ranking)
// and computeTier (gamification math) — engine logic the live upstream
// (Bitget 405 / Gate 401) cannot exercise.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { sortByMetrics, scoreOf } from '../ranking'
import { computeTier } from '@/lib/gamification-tier'
import type { MemeAlphaToken } from '../types'

// Exact composite formula (mirrors ranking.ts scoreOf):
//   score = volume24h/1e6 + marketCap/1e9 + change24h   (change24h un-scaled)
// We assert the EXACT computed score per fixture, and only use fixtures with
// equal change24h (here 0) when we want volume/marketCap to drive the order,
// so the expected ranking is unambiguous and not dominated by momentum.

function makeToken(
  id: string,
  metrics: Partial<Pick<MemeAlphaToken, 'volume24h' | 'marketCap' | 'change24h'>> = {},
): MemeAlphaToken {
  return {
    id,
    platform: 'bitget',
    chain: 'ethereum',
    contract: `0x${id}`,
    symbol: id.toUpperCase(),
    name: id,
    price: 0,
    change24h: metrics.change24h ?? 0,
    volume24h: metrics.volume24h ?? 0,
    marketCap: metrics.marketCap ?? 0,
    liquidity: 0,
    createdAt: null,
    riskLevel: 0,
    holders: 0,
    top10HolderPercent: 0,
    social: {},
    audited: false,
  }
}

describe('scoreOf — exact ranking formula', () => {
  it('decomposes to volume24h/1e6 + marketCap/1e9 + change24h', () => {
    expect(scoreOf(makeToken('v', { volume24h: 10_000_000 }))).toBe(10)
    expect(scoreOf(makeToken('c', { marketCap: 5_000_000_000 }))).toBe(5)
    expect(scoreOf(makeToken('m', { change24h: 30 }))).toBe(30)
  })

  it('defaults missing metrics to 0', () => {
    expect(scoreOf(makeToken('empty'))).toBe(0)
    expect(
      scoreOf(makeToken('mixed', { volume24h: 2_000_000, marketCap: 3_000_000_000 })),
    ).toBe(2 + 3)
  })

  it('momentum un-scaled outweighs volume/mcap by orders of magnitude', () => {
    const momentum = scoreOf(makeToken('m', { change24h: 30 })) // 30
    const bigStat = scoreOf(
      makeToken('b', { volume24h: 10_000_000, marketCap: 5_000_000_000 }),
    ) // 15
    expect(momentum).toBeGreaterThan(bigStat)
  })
})

describe('sortByMetrics', () => {
  it('ranks by exact composite descending (equal change24h -> volume/mcap drives order)', () => {
    // All change24h = 0. score = volume24h/1e6 + marketCap/1e9.
    const v10m = makeToken('v10m', { volume24h: 10_000_000, marketCap: 0 }) // 10
    const v5m = makeToken('v5m', { volume24h: 5_000_000, marketCap: 0 }) // 5
    const cap5b = makeToken('cap5b', { volume24h: 0, marketCap: 5_000_000_000 }) // 5
    const cap2b = makeToken('cap2b', { volume24h: 0, marketCap: 2_000_000_000 }) // 2
    const empty = makeToken('empty') // 0
    const ranked = sortByMetrics([cap2b, v5m, empty, cap5b, v10m])
    // Hand-computed: v10m(10) > v5m(5) == cap5b(5) > cap2b(2) > empty(0)
    expect(ranked.map((t) => t.id)).toEqual(['v10m', 'v5m', 'cap5b', 'cap2b', 'empty'])
    // The two score-5 tokens keep relative input order (v5m before cap5b).
    expect(scoreOf(v5m)).toBe(5)
    expect(scoreOf(cap5b)).toBe(5)
  })

  it('momentum breaks ties and dominates (mirrors live endpoint reality)', () => {
    const momentum = makeToken('momentum', { change24h: 30 }) // 30
    const big = makeToken('big', { volume24h: 10_000_000, marketCap: 5_000_000_000 }) // 15
    const ranked = sortByMetrics([big, momentum])
    expect(ranked.map((t) => t.id)).toEqual(['momentum', 'big'])
  })

  it('does not mutate the input array', () => {
    const input = [makeToken('x', { volume24h: 5_000_000 }), makeToken('y')]
    const snapshot = input.map((t) => t.id)
    sortByMetrics(input)
    expect(input.map((t) => t.id)).toEqual(snapshot)
  })
})

describe('computeTier', () => {
  const cases: Array<{
    xp: number
    tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
    level: number
    nextTierXp: number | null
    progress: number
  }> = [
    { xp: -10, tier: 'Bronze', level: 1, nextTierXp: 500, progress: 0 },
    { xp: 0, tier: 'Bronze', level: 1, nextTierXp: 500, progress: 0 },
    { xp: 499, tier: 'Bronze', level: 2, nextTierXp: 500, progress: 0.998 },
    { xp: 500, tier: 'Silver', level: 3, nextTierXp: 1500, progress: 0 },
    { xp: 1499, tier: 'Silver', level: 6, nextTierXp: 1500, progress: 0.999 },
    { xp: 1500, tier: 'Gold', level: 7, nextTierXp: 4000, progress: 0 },
    { xp: 3999, tier: 'Gold', level: 16, nextTierXp: 4000, progress: 0.9996 },
    { xp: 4000, tier: 'Platinum', level: 17, nextTierXp: null, progress: 1 },
  ]

  for (const c of cases) {
    it(`xp=${c.xp} -> ${c.tier} L${c.level}`, () => {
      const info = computeTier(c.xp)
      expect(info.tier).toBe(c.tier)
      expect(info.level).toBe(c.level)
      expect(info.nextTierXp).toBe(c.nextTierXp)
      expect(info.progress).toBeCloseTo(c.progress, 3)
    })
  }
})
