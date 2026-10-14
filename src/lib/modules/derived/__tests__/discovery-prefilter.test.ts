import { describe, it, expect } from 'vitest'
import { prefilterCandidates } from '../sniper-scan'
import type { SniperEnrichedToken } from '../sniper-source'

function tok(over: Partial<SniperEnrichedToken> = {}): SniperEnrichedToken {
  return {
    id: 'solana:Token',
    platform: 'dexscreener',
    chain: 'solana',
    contract: 'Token',
    symbol: 'TKN',
    name: 'Token',
    price: 0,
    change24h: 0,
    volume24h: 0,
    marketCap: 100_000,
    liquidity: 50_000,
    createdAt: Date.now(),
    riskLevel: 0,
    holders: 0,
    top10HolderPercent: 0,
    social: {},
    audited: false,
    ...over,
  }
}

const FLOORS = { minMcUsd: 5_000, minLiqUsd: 2_000 }

describe('prefilterCandidates', () => {
  it('skips a candidate with known market cap below the floor', () => {
    const res = prefilterCandidates([tok({ marketCap: 4_999 })], FLOORS)
    expect(res.kept).toHaveLength(0)
    expect(res.skipped).toBe(1)
    expect(res.unknownMc).toBe(0)
  })

  it('skips a candidate with known liquidity below the floor', () => {
    const res = prefilterCandidates([tok({ liquidity: 1_999 })], FLOORS)
    expect(res.kept).toHaveLength(0)
    expect(res.skipped).toBe(1)
    expect(res.unknownLiq).toBe(0)
  })

  it('keeps a candidate with null market cap and null liquidity (UNKNOWN passes through)', () => {
    const res = prefilterCandidates([tok({ marketCap: 0, liquidity: 0 })], FLOORS)
    expect(res.kept).toHaveLength(1)
    expect(res.skipped).toBe(0)
    expect(res.unknownMc).toBe(1)
    expect(res.unknownLiq).toBe(1)
  })

  it('keeps a candidate above both floors', () => {
    const res = prefilterCandidates([tok({ marketCap: 20_000, liquidity: 8_000 })], FLOORS)
    expect(res.kept).toHaveLength(1)
    expect(res.skipped).toBe(0)
  })

  it('counts skipped, unknown-mc, unknown-liq and kept correctly across a mixed batch', () => {
    const res = prefilterCandidates(
      [
        tok({ contract: 'LOW_MC', marketCap: 10 }),
        tok({ contract: 'LOW_LIQ', liquidity: 10 }),
        tok({ contract: 'UNKNOWN', marketCap: 0, liquidity: 0 }),
        tok({ contract: 'GOOD', marketCap: 50_000, liquidity: 30_000 }),
      ],
      FLOORS,
    )
    expect(res.skipped).toBe(2)
    expect(res.unknownMc).toBe(1)
    expect(res.unknownLiq).toBe(1)
    expect(res.kept).toHaveLength(2)
    expect(res.kept.map((t) => t.contract)).toEqual(['UNKNOWN', 'GOOD'])
  })

  it('is deterministic and does not mutate the input', () => {
    const list = [tok({ marketCap: 1 }), tok({ marketCap: 0 }), tok({ marketCap: 9_000 })]
    const before = JSON.stringify(list)
    const a = prefilterCandidates(list, FLOORS)
    const b = prefilterCandidates(list, FLOORS)
    expect(a).toEqual(b)
    expect(a.kept.map((t) => t.contract)).toEqual(b.kept.map((t) => t.contract))
    expect(JSON.stringify(list)).toBe(before)
  })

  it('uses explicit floors (env default is applied by the caller)', () => {
    const strict = prefilterCandidates([tok({ marketCap: 9_000 })], { minMcUsd: 10_000, minLiqUsd: 2_000 })
    expect(strict.skipped).toBe(1)
    const loose = prefilterCandidates([tok({ marketCap: 9_000 })], { minMcUsd: 5_000, minLiqUsd: 2_000 })
    expect(loose.kept).toHaveLength(1)
  })

  it('never rejects on null when only one side is below floor but the other is unknown', () => {
    const res = prefilterCandidates([tok({ marketCap: 10, liquidity: 0 })], FLOORS)
    expect(res.skipped).toBe(1) // proven MC junk — the null liquidity is not a pardon
    const res2 = prefilterCandidates([tok({ marketCap: 0, liquidity: 10 })], FLOORS)
    expect(res2.skipped).toBe(1) // proven liquidity junk — the null MC is not a pardon
  })
})
