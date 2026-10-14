import { describe, it, expect } from 'vitest'
import { formatTieredSignal, type SignalFormatInput } from '../signal-tier'
import type { SniperPayload } from '../meme-sniper'

function payload(over: Partial<SniperPayload> = {}): SniperPayload {
  return {
    ticker: 'TEST',
    contract: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    ageMinutes: 30,
    security: {
      mintable: false,
      freezeAuthority: false,
      honeypot: false,
      lpBurnedPercent: 100,
      lpLockedPercent: null,
    },
    distribution: { top10Percent: 12, devPercent: 0, sniperPercent: 3, bundlerPercent: 2, insiderPercent: 0 },
    momentum: { marketCap: 250_000, volume5m: 60_000 },
    ...over,
  } as SniperPayload
}

function input(over: Partial<SignalFormatInput> = {}): SignalFormatInput {
  return {
    payload: payload(),
    tier: 'HIGH_CONVICTION',
    tierReasons: [],
    tierMissing: [],
    smartMoney: null,
    marketCapUsd: 250_000,
    ...over,
  }
}

/** The first line is the header; the badge lives on the same line. */
function header(out: { text: string }): string {
  return out.text.split('\n')[0]
}

describe('tier-aware channel header', () => {
  it('HIGH_CONVICTION gets its own primary-signal title', () => {
    const h = header(formatTieredSignal(input({ tier: 'HIGH_CONVICTION' })))
    expect(h).toContain('HIGH CONVICTION SIGNAL')
    expect(h).not.toContain('POTENTIAL COIN SIGNAL')
  })

  it('CANDIDATE keeps the reserved POTENTIAL COIN SIGNAL title', () => {
    const h = header(formatTieredSignal(input({ tier: 'CANDIDATE' })))
    expect(h).toContain('POTENTIAL COIN SIGNAL')
    expect(h).not.toContain('HIGH CONVICTION SIGNAL')
  })

  it('WATCHLIST keeps the reserved POTENTIAL COIN SIGNAL title', () => {
    const h = header(formatTieredSignal(input({ tier: 'WATCHLIST' })))
    expect(h).toContain('POTENTIAL COIN SIGNAL')
    expect(h).not.toContain('HIGH CONVICTION SIGNAL')
  })

  it('keeps the tier badge for every tier, including HIGH_CONVICTION', () => {
    expect(header(formatTieredSignal(input({ tier: 'HIGH_CONVICTION' })))).toContain('🟢 <b>HIGH-CONVICTION</b>')
    expect(header(formatTieredSignal(input({ tier: 'CANDIDATE' })))).toContain('🟡 <b>CANDIDATE</b>')
    expect(header(formatTieredSignal(input({ tier: 'WATCHLIST' })))).toContain('🟡 <b>WATCHLIST</b>')
    expect(header(formatTieredSignal(input({ tier: 'UNKNOWN' })))).toContain('⚪ <b>UNKNOWN</b>')
    expect(header(formatTieredSignal(input({ tier: 'STALE' })))).toContain('⚫ <b>STALE</b>')
    expect(header(formatTieredSignal(input({ tier: 'REJECT' })))).toContain('🔴 <b>REJECT</b>')
  })

  it('leaves UNKNOWN/STALE/REJECT headers on the unchanged reserved title', () => {
    for (const tier of ['UNKNOWN', 'STALE', 'REJECT'] as const) {
      const h = header(formatTieredSignal(input({ tier })))
      expect(h).toContain('POTENTIAL COIN SIGNAL')
      expect(h).not.toContain('HIGH CONVICTION SIGNAL')
    }
  })

  it('keeps the header HTML balanced on every tier', () => {
    for (const tier of ['HIGH_CONVICTION', 'CANDIDATE', 'WATCHLIST', 'UNKNOWN', 'STALE', 'REJECT'] as const) {
      const h = header(formatTieredSignal(input({ tier })))
      const opens = (h.match(/<b>/g) ?? []).length
      const closes = (h.match(/<\/b>/g) ?? []).length
      expect(opens).toBeGreaterThan(0)
      expect(closes).toBe(opens)
    }
  })
})
