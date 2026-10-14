import { describe, it, expect } from 'vitest'
import { extractContractFromAlert, shouldSuppressDelivery } from '../meme-sniper'

const MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'
const PUMP = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'

describe('extractContractFromAlert', () => {
  it('pulls the mint from a <code> tag first', () => {
    expect(extractContractFromAlert(`<b>Token:</b> $TEST <code>${MINT}</code> | Pump.fun`)).toBe(MINT)
  })

  it('finds a pump-suffixed base58 token', () => {
    expect(extractContractFromAlert(`mint ${PUMP} lauched now`)).toBe(PUMP)
  })

  it('falls back to a plain base58 token', () => {
    expect(extractContractFromAlert(`alarm for token ${MINT} — do not chase`)).toBe(MINT)
  })

  it('prefers a <code> mint even when another base58 token appears', () => {
    const text = `<code>${MINT}</code> compared against ${PUMP}`
    expect(extractContractFromAlert(text)).toBe(MINT)
  })

  it('returns null when no mint-shaped token exists', () => {
    expect(extractContractFromAlert('just a narrative with no token')).toBeNull()
    expect(extractContractFromAlert('')).toBeNull()
  })
})

describe('shouldSuppressDelivery', () => {
  it('never suppresses when cooldown is 0 (disabled)', () => {
    expect(shouldSuppressDelivery(MINT, Date.now() - 60_000, Date.now(), 0)).toBe(false)
  })

  it('suppresses when the last success is inside the cooldown window', () => {
    const now = 1_000_000
    expect(shouldSuppressDelivery(MINT, now - 59_999, now, 60_000)).toBe(true)
  })

  it('allows when the last success is outside the window', () => {
    const now = 1_000_000
    expect(shouldSuppressDelivery(MINT, now - 60_001, now, 60_000)).toBe(false)
  })

  it('allows at the exact cooldown boundary', () => {
    const now = 1_000_000
    expect(shouldSuppressDelivery(MINT, now - 60_000, now, 60_000)).toBe(false)
  })

  it('allows when there is no prior success (null lastOk)', () => {
    expect(shouldSuppressDelivery(MINT, null, Date.now(), 60_000)).toBe(false)
  })

  it('allows when there is no contract (null contract)', () => {
    expect(shouldSuppressDelivery(null, Date.now() - 1_000, Date.now(), 60_000)).toBe(false)
  })
})
