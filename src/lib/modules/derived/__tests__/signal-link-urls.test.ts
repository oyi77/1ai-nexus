import { describe, it, expect } from 'vitest'
import { contractButtons, validateSignalLinkUrls } from '../signal-tier'

const MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'
const PUMP = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'

describe('validateSignalLinkUrls', () => {
  it('validates a solana mint and returns the full mint in chart + swap URLs', () => {
    const v = validateSignalLinkUrls(MINT, 'solana')
    expect(v.valid).toBe(true)
    expect(v.chartUrl).toBe(`https://dexscreener.com/solana/${encodeURIComponent(MINT)}`)
    expect(v.swapUrl).toBe(`https://jup.ag/swap/${encodeURIComponent(MINT)}-USDC`)
    expect(v.chartUrl).toContain(MINT)
    expect(v.swapUrl).toContain(MINT)
  })

  it('routes a pump mint to the SOL-pair swap', () => {
    const v = validateSignalLinkUrls(PUMP, 'solana')
    expect(v.valid).toBe(true)
    expect(v.swapUrl).toBe(`https://jup.ag/swap/SOL-${encodeURIComponent(PUMP)}`)
  })

  it('treats an empty contract as invalid', () => {
    expect(validateSignalLinkUrls('', 'solana').valid).toBe(false)
    expect(validateSignalLinkUrls('', 'solana').chartUrl).toBeNull()
    expect(validateSignalLinkUrls('', 'solana').swapUrl).toBeNull()
  })

  it('treats a non-base58 contract as invalid', () => {
    const v = validateSignalLinkUrls('not a mint!', 'solana')
    expect(v.valid).toBe(false)
    expect(v.reason).toContain('base58')
  })

  it('treats an unsupported chain as invalid', () => {
    const v = validateSignalLinkUrls(MINT, 'ethereum')
    expect(v.valid).toBe(false)
    expect(v.reason).toContain('unsupported chain')
  })

  it('always emits a swapUrl when the builder actually emits one', () => {
    // Both branches of contractButtons emit Jupiter swap links for valid mints.
    expect(validateSignalLinkUrls(MINT, 'solana').swapUrl).not.toBeNull()
    expect(validateSignalLinkUrls(PUMP, 'solana').swapUrl).not.toBeNull()
  })
})

describe('contractButtons uses validated URLs', () => {
  it('keeps the original provider URLs for a valid mint', () => {
    const kb = contractButtons(MINT, 'solana')
    const urls = kb.inline_keyboard.flat().map((b) => b.url)
    expect(urls).toContain(`https://axiom.trade/t/${encodeURIComponent(MINT)}`)
    expect(urls).toContain(`https://jup.ag/swap/${encodeURIComponent(MINT)}-USDC`)
    expect(urls).toContain(`https://dexscreener.com/solana/${encodeURIComponent(MINT)}`)
    expect(urls).toContain(`https://gmgn.ai/sol/token/${encodeURIComponent(MINT)}`)
  })

  it('omits the keyboard when the contract is invalid', () => {
    expect(contractButtons('', 'solana').inline_keyboard).toEqual([])
    expect(contractButtons('nope', 'solana').inline_keyboard).toEqual([])
  })
})
