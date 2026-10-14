import { describe, it, expect } from 'vitest'
import {
  collapseDuplicateCandidatesByTrust,
  compareByTrust,
  normalizeTickerForDedup,
} from '../candidate-trust'
import type { SniperEnrichedToken } from '../sniper-source'
import type { CandidateEvidence } from '../unified-candidate'

function tok(over: Partial<SniperEnrichedToken> = {}): SniperEnrichedToken {
  return {
    id: `solana:${over.contract ?? 'AAA'}`,
    platform: 'dexscreener',
    chain: 'solana',
    contract: 'AAA',
    symbol: 'TKN',
    name: 'Token',
    price: 0,
    change24h: 0,
    volume24h: 0,
    marketCap: 100_000,
    liquidity: 50_000,
    createdAt: Date.now() - 30 * 60_000,
    riskLevel: 0,
    holders: 0,
    top10HolderPercent: 0,
    social: {},
    audited: false,
    ...over,
  }
}

function ev(provider: string): CandidateEvidence {
  return { provider, category: 'NEW_PAIRS', discoveredAt: Date.now() }
}

describe('normalizeTickerForDedup', () => {
  it('strips leading $, lowercases, removes non-alphanumeric', () => {
    expect(normalizeTickerForDedup('$DOGE')).toBe('doge')
    expect(normalizeTickerForDedup('doge')).toBe('doge')
    expect(normalizeTickerForDedup('DOGE!')).toBe('doge')
    expect(normalizeTickerForDedup(' $Doge ')).toBe('doge')
    expect(normalizeTickerForDedup('$$PEPE')).toBe('pepe')
    expect(normalizeTickerForDedup('WIF-2.0')).toBe('wif20')
    expect(normalizeTickerForDedup(undefined)).toBe('')
    expect(normalizeTickerForDedup('')).toBe('')
  })
})

describe('collapseDuplicateCandidatesByTrust', () => {
  it('keeps all candidates when tickers are unique', () => {
    const candidates = [
      tok({ contract: 'c1', symbol: 'PEPE' }),
      tok({ contract: 'c2', symbol: 'DOGE' }),
      tok({ contract: 'c3', symbol: 'WIF' }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(3)
    expect(dropped).toHaveLength(0)
  })

  it('higher liquidity wins when two mints share a ticker', () => {
    const candidates = [
      tok({ contract: 'c1', symbol: 'PEPE', liquidity: 10_000 }),
      tok({ contract: 'c2', symbol: 'PEPE', liquidity: 50_000 }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(1)
    expect(kept[0].contract).toBe('c2')
    expect(dropped).toHaveLength(1)
    expect(dropped[0].candidate.contract).toBe('c1')
    expect(dropped[0].reason).toContain('higher liquidity')
    expect(dropped[0].reason).toContain('c2')
  })

  it('more audit evidence wins when liquidity is equal', () => {
    const candidates = [
      tok({
        contract: 'c1',
        symbol: 'BONK',
        liquidity: 50_000,
        discoveryEvidence: [ev('dexscreener')],
      }),
      tok({
        contract: 'c2',
        symbol: 'BONK',
        liquidity: 50_000,
        discoveryEvidence: [ev('dexscreener'), ev('birdeye')],
      }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(1)
    expect(kept[0].contract).toBe('c2')
    expect(dropped).toHaveLength(1)
    expect(dropped[0].candidate.contract).toBe('c1')
    expect(dropped[0].reason).toContain('more audit sources')
    expect(dropped[0].reason).toContain('c2')
  })

  it('normalization groups $DOGE, doge, and DOGE! together', () => {
    const candidates = [
      tok({ contract: 'c1', symbol: '$DOGE', liquidity: 20_000 }),
      tok({ contract: 'c2', symbol: 'doge', liquidity: 80_000 }),
      tok({ contract: 'c3', symbol: 'DOGE!', liquidity: 10_000 }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(1)
    expect(kept[0].contract).toBe('c2')
    expect(dropped).toHaveLength(2)
    const droppedContracts = dropped.map((d) => d.candidate.contract).sort()
    expect(droppedContracts).toEqual(['c1', 'c3'])
  })

  it('deterministic tie-breaking by contract address', () => {
    // Identical liquidity, identical audit consensus, identical age/mc —
    // the only differentiator is the contract string.
    const now = Date.now() - 30 * 60_000
    const candidates = [
      tok({ contract: 'ZZZ', symbol: 'TIE', liquidity: 50_000, createdAt: now, marketCap: 100_000 }),
      tok({ contract: 'AAA', symbol: 'TIE', liquidity: 50_000, createdAt: now, marketCap: 100_000 }),
      tok({ contract: 'MMM', symbol: 'TIE', liquidity: 50_000, createdAt: now, marketCap: 100_000 }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(1)
    // Lexicographically smallest contract wins (AAA < MMM < ZZZ).
    expect(kept[0].contract).toBe('AAA')
    expect(dropped).toHaveLength(2)
  })

  it('handles empty input', () => {
    const { kept, dropped } = collapseDuplicateCandidatesByTrust([])
    expect(kept).toHaveLength(0)
    expect(dropped).toHaveLength(0)
  })

  it('does not mutate the input array', () => {
    const candidates = [
      tok({ contract: 'c1', symbol: 'PEPE', liquidity: 10_000 }),
      tok({ contract: 'c2', symbol: 'PEPE', liquidity: 50_000 }),
    ]
    const snapshot = candidates.map((c) => ({ ...c }))
    collapseDuplicateCandidatesByTrust(candidates)
    expect(candidates).toHaveLength(snapshot.length)
    for (let i = 0; i < candidates.length; i++) {
      expect(candidates[i].contract).toBe(snapshot[i].contract)
      expect(candidates[i].liquidity).toBe(snapshot[i].liquidity)
    }
  })

  it('collapses across multiple ticker groups independently', () => {
    const candidates = [
      tok({ contract: 'p1', symbol: 'PEPE', liquidity: 50_000 }),
      tok({ contract: 'p2', symbol: 'PEPE', liquidity: 10_000 }),
      tok({ contract: 'd1', symbol: 'DOGE', liquidity: 20_000 }),
      tok({ contract: 'd2', symbol: 'DOGE', liquidity: 80_000 }),
      tok({ contract: 'w1', symbol: 'WIF', liquidity: 5_000 }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(3)
    const keptContracts = kept.map((c) => c.contract).sort()
    expect(keptContracts).toEqual(['d2', 'p1', 'w1'])
    expect(dropped).toHaveLength(2)
  })

  it('blank/empty ticker treated as unique-per-contract (never merged)', () => {
    const candidates = [
      tok({ contract: 'c1', symbol: '', liquidity: 10_000 }),
      tok({ contract: 'c2', symbol: '$$$', liquidity: 50_000 }),
      tok({ contract: 'c3', symbol: undefined, liquidity: 5_000 }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(3)
    expect(dropped).toHaveLength(0)
  })

  it('older token wins when liquidity and audit consensus are equal', () => {
    const oldTs = Date.now() - 120 * 60_000
    const newTs = Date.now() - 5 * 60_000
    const candidates = [
      tok({ contract: 'fresh', symbol: 'BONK', liquidity: 50_000, createdAt: newTs }),
      tok({ contract: 'old', symbol: 'BONK', liquidity: 50_000, createdAt: oldTs }),
    ]
    const { kept, dropped } = collapseDuplicateCandidatesByTrust(candidates)
    expect(kept).toHaveLength(1)
    expect(kept[0].contract).toBe('old')
    expect(dropped[0].reason).toContain('older token')
  })
})

describe('compareByTrust', () => {
  it('returns negative when first argument is more trusted', () => {
    const a = tok({ contract: 'a', liquidity: 100_000 })
    const b = tok({ contract: 'b', liquidity: 10_000 })
    expect(compareByTrust(a, b)).toBeLessThan(0)
  })

  it('returns positive when second argument is more trusted', () => {
    const a = tok({ contract: 'a', liquidity: 10_000 })
    const b = tok({ contract: 'b', liquidity: 100_000 })
    expect(compareByTrust(a, b)).toBeGreaterThan(0)
  })
})
