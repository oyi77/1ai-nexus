import { describe, expect, it } from 'vitest'
import { rankCandidates, CONFIDENCE_GATE, type MoonshotCandidate } from '@/lib/moonshot/rank'

function c(over: Partial<MoonshotCandidate>): MoonshotCandidate {
  return {
    leg: 'idx', asset: 'BBCA', direction: 'bullish',
    gainPct: 20, horizonHrs: 720, hitRate: 40, confidence: 80,
    reason: 'test',
    ...over,
  }
}

describe('rankCandidates', () => {
  it('gates below-confidence candidates (default 70)', () => {
    const board = rankCandidates([c({ confidence: 69 }), c({ confidence: 70 })])
    expect(board).toHaveLength(1)
    expect(board[0].confidence).toBe(70)
    expect(CONFIDENCE_GATE).toBe(70)
  })

  it('ranks by expected gain per hour x hit-rate, fastest tail first', () => {
    const slow = c({ asset: 'SLOW', gainPct: 20, horizonHrs: 720, hitRate: 40 }) // 0.0111/hr
    const fast = c({ asset: 'FAST', gainPct: 8, horizonHrs: 2, hitRate: 60 }) // 2.4/hr
    const board = rankCandidates([slow, fast])
    expect(board[0].asset).toBe('FAST')
    expect(board[0].expectedHourly).toBeCloseTo(2.4, 2)
  })

  it('caps the board at 10', () => {
    const many = Array.from({ length: 15 }, (_, i) => c({ asset: `S${i}` }))
    expect(rankCandidates(many)).toHaveLength(10)
  })
  it('drops non-positive gain or horizon', () => {
    const board = rankCandidates([c({ gainPct: 0 }), c({ horizonHrs: 0 }), c({ gainPct: 10, horizonHrs: 24 })])
    expect(board).toHaveLength(1)
    expect(board[0].gainPct).toBe(10)
  })

  it('keeps a 71.3-confidence IDX moonshot above the 70 gate', () => {
    // Measured P10 for lane=moonshot verdict=moonshot is 71.3 — the IDX leg
    // confidence source. Must survive the gate.
    const board = rankCandidates([c({ leg: 'idx', confidence: 71.3, gainPct: 20, horizonHrs: 720, hitRate: 49.3 })])
    expect(board).toHaveLength(1)
  })

  it('gates a capped-60 unproven candidate out', () => {
    // Unproven legs (launch/crypto-without-history) cap at 60 — gated out.
    const board = rankCandidates([c({ leg: 'launch', confidence: 60 })])
    expect(board).toHaveLength(0)
  })

  it('tie-breaks identical expectedHourly by engine score', () => {
    // IDX candidates share gain/horizon/hitRate — order must follow score,
    // not insertion order.
    const lo = c({ asset: 'LO', score: 78 })
    const hi = c({ asset: 'HI', score: 85 })
    const board = rankCandidates([lo, hi])
    expect(board[0].asset).toBe('HI')
    expect(board[1].asset).toBe('LO')
  })
})
