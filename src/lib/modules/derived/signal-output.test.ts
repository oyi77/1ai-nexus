import { describe, it, expect } from 'vitest'
import { formatTieredSignal, contractButtons, type SignalFormatInput } from './signal-tier'
import type { SniperPayload } from './meme-sniper'

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
    expect(out.text).toContain('VILONA SNIPER')
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
    // Legacy-Markdown bold would be `*VILONA`; HTML must use <b>.
    expect(out.text).not.toContain('*VILONA')
    expect(out.text).toContain('<b>VILONA SNIPER')
  })
})
