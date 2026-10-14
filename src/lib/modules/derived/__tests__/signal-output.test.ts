import { describe, it, expect } from 'vitest'
import { formatTieredSignal, contractButtons, type SignalFormatInput } from '../signal-tier'
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

describe('signal output — reply markup', () => {
  it('returns text plus a button keyboard by default', () => {
    const out = formatTieredSignal(input())
    expect(typeof out.text).toBe('string')
    expect(out.text).toContain('HIGH CONVICTION SIGNAL')
    expect(out.replyMarkup).toBeDefined()
    expect(out.replyMarkup!.inline_keyboard.length).toBeGreaterThan(0)
    for (const row of out.replyMarkup!.inline_keyboard) {
      for (const b of row) {
        expect(b.text.length).toBeGreaterThan(0)
        expect(b.url).toMatch(/^https:\/\//)
      }
    }
  })

  it('omits the keyboard when sendButtons is false', () => {
    expect(formatTieredSignal(input({ sendButtons: false })).replyMarkup).toBeUndefined()
  })

  it('builds buy + chart links for the exact contract', () => {
    const c = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'
    const kb = contractButtons(c, 'solana')
    const urls = kb.inline_keyboard.flat().map((b) => b.url)
    expect(urls.some((u) => u.includes(encodeURIComponent(c)))).toBe(true)
    expect(urls.some((u) => u.includes('dexscreener.com/solana/'))).toBe(true)
  })

  it('routes pump.fun mints to the SOL-pair swap', () => {
    const c = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'
    const urls = contractButtons(c, 'solana').inline_keyboard.flat().map((b) => b.url)
    expect(urls.some((u) => u.includes('jup.ag/swap/SOL-'))).toBe(true)
  })

  it('passes underscored tickers through — HTML mode cannot be broken by _', () => {
    const out = formatTieredSignal(input({ payload: payload({ ticker: 'A_B' }) }))
    expect(out.text).toContain('$A_B')
    expect(out.text).not.toContain('A\\_B')
    expect(out.text).not.toContain('*POTENTIAL')
    expect(out.text).toContain('<b>HIGH CONVICTION SIGNAL</b>')
  })
})

describe('signal output — SHADOW status and audit provenance (TAHAP 5)', () => {
  it('always states SHADOW/PAPER status in the message body', () => {
    const out = formatTieredSignal(input())
    expect(out.text).toContain('SHADOW (PAPER)')
    expect(out.text).toContain('Output screening')
  })

  it('reports cross-confirmation when two or more audits agreed', () => {
    const out = formatTieredSignal(input({ auditSources: ['rugcheck', 'rugged-proof'] }))
    expect(out.text).toContain('2 sources agreed')
    expect(out.text).toContain('rugcheck')
  })

  it('flags a single audit as no cross-confirmation, not as agreement', () => {
    const out = formatTieredSignal(input({ auditSources: ['rugcheck'] }))
    expect(out.text).toContain('1 source only')
    expect(out.text).not.toContain('sources agreed')
  })

  it('reports absent provenance honestly instead of implying a pass', () => {
    const out = formatTieredSignal(input({ auditSources: [] }))
    expect(out.text).toContain('No confirmed audit sources')
  })
})
