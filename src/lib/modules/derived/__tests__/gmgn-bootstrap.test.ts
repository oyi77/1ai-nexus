import { describe, expect, it } from 'vitest'
import {
  gmgnBootstrapInput,
  gmgnStatusFor,
  type GmgnBootstrapRow,
} from '../gmgn-bootstrap'

function row(overrides: Partial<GmgnBootstrapRow>): GmgnBootstrapRow {
  return {
    address: 'addr',
    winRate30d: 0.6,
    pnl30d: 0.7,
    realizedProfit30d: 10,
    tags: [],
    ...overrides,
  }
}

describe('gmgnStatusFor', () => {
  it('maps null winrate or pnl to UNKNOWN (unmeasured is not safe)', () => {
    expect(gmgnStatusFor(row({ winRate30d: null, pnl30d: 0.7 })).status).toBe('UNKNOWN')
    expect(gmgnStatusFor(row({ winRate30d: 0.6, pnl30d: null })).status).toBe('UNKNOWN')
    expect(gmgnStatusFor(row({ winRate30d: null, pnl30d: null })).status).toBe('UNKNOWN')
  })

  it('maps winrate>=0.6 && pnl>=0.7 to PROVISIONAL with medium confidence', () => {
    const verdict = gmgnStatusFor(row({ winRate30d: 0.8, pnl30d: 0.9 }))

    expect(verdict.status).toBe('PROVISIONAL')
    expect(verdict.confidence).toBe('medium')
    expect(verdict.reasons.some((r) => r.includes('GMGN'))).toBe(true)
  })

  it('maps winrate below 0.6 to WATCHLIST', () => {
    const verdict = gmgnStatusFor(row({ winRate30d: 0.5, pnl30d: 0.8 }))

    expect(verdict.status).toBe('WATCHLIST')
    expect(verdict.confidence).toBe('low')
  })

  it('maps pnl below 0.7 to WATCHLIST', () => {
    expect(gmgnStatusFor(row({ winRate30d: 0.8, pnl30d: 0.69 })).status).toBe('WATCHLIST')
  })

  it('is boundary-inclusive: exactly 0.6 winrate + exactly 0.7 pnl is PROVISIONAL', () => {
    expect(gmgnStatusFor(row({ winRate30d: 0.6, pnl30d: 0.7 })).status).toBe('PROVISIONAL')
  })

  it('notes the full-classifier-may-overwrite limitation', () => {
    const verdict = gmgnStatusFor(row({}))

    expect(
      verdict.limitations.some((l) =>
        l.toLowerCase().includes('full wallet-intel classifier may overwrite'),
      ),
    ).toBe(true)
  })

  it('is deterministic for identical input', () => {
    const input = row({ winRate30d: 0.75, pnl30d: 1.2 })
    const a = gmgnStatusFor(input)
    const b = gmgnStatusFor(input)

    expect(b).toEqual(a)
  })

  it('normalizes tags to [] when omitted', () => {
    expect(
      gmgnBootstrapInput({
        address: 'a',
        winRate30d: 0.6,
        pnl30d: 0.7,
        realizedProfit30d: null,
      }),
    ).toMatchObject({ address: 'a', tags: [] })
  })
})
