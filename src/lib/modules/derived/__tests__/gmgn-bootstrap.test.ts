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
    buyVolume30d: null,
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

  it('maps buyVolume30d >= $250k to WHALE even when winrate/pnl are below bars', () => {
    const verdict = gmgnStatusFor(
      row({ buyVolume30d: 300_000, winRate30d: 0.4, pnl30d: 0.2 }),
    )

    expect(verdict.status).toBe('WHALE')
    expect(verdict.confidence).toBe('medium')
    expect(verdict.reasons.some((r) => r.includes('whale leg'))).toBe(true)
  })

  it('keeps the whale verdict even when winrate/pnl are null (volume leg is independent)', () => {
    expect(
      gmgnStatusFor(
        row({ buyVolume30d: 400_000, winRate30d: null, pnl30d: null }),
      ).status,
    ).toBe('WHALE')
  })

  it('is boundary-inclusive at exactly $250k and excludes $249,999.99', () => {
    expect(gmgnStatusFor(row({ buyVolume30d: 250_000 })).status).toBe('WHALE')
    expect(
      gmgnStatusFor(
        row({ buyVolume30d: 249_999.99, winRate30d: 0.6, pnl30d: 0.7 }),
      ).status,
    ).not.toBe('WHALE')
  })

  it('lets high-quality wallets below the volume threshold fall through to PROVISIONAL', () => {
    expect(
      gmgnStatusFor(
        row({ buyVolume30d: 249_000, winRate30d: 0.8, pnl30d: 0.9 }),
      ).status,
    ).toBe('PROVISIONAL')
  })

  it('lets low-quality wallets below the volume threshold fall through to WATCHLIST', () => {
    expect(
      gmgnStatusFor(
        row({ buyVolume30d: 10_000, winRate30d: 0.5, pnl30d: 0.8 }),
      ).status,
    ).toBe('WATCHLIST')
  })

  it('falls through to UNKNOWN when buyVolume30d is null and stats are unmeasured', () => {
    expect(
      gmgnStatusFor(row({ buyVolume30d: null, winRate30d: null, pnl30d: null }))
        .status,
    ).toBe('UNKNOWN')
  })

  it('never emits WHALE_AND_SMART_MONEY or QUALIFIED_SMART_MONEY for a high-volume wallet', () => {
    const verdict = gmgnStatusFor(
      row({ buyVolume30d: 900_000, winRate30d: 0.9, pnl30d: 2.0 }),
    )

    expect(verdict.status).toBe('WHALE')
    expect(verdict.status).not.toBe('WHALE_AND_SMART_MONEY')
    expect(verdict.status).not.toBe('QUALIFIED_SMART_MONEY')
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

  it('normalizes tags to [] and buyVolume30d to null when omitted', () => {
    expect(
      gmgnBootstrapInput({
        address: 'a',
        winRate30d: 0.6,
        pnl30d: 0.7,
        realizedProfit30d: null,
      }),
    ).toMatchObject({ address: 'a', tags: [], buyVolume30d: null })
    expect(
      gmgnBootstrapInput({
        address: 'b',
        winRate30d: null,
        pnl30d: null,
        realizedProfit30d: null,
        buyVolume30d: 300_000,
      }),
    ).toMatchObject({ address: 'b', buyVolume30d: 300_000 })
  })
})
