import { describe, it, expect } from 'vitest'
import { contractButtons } from '../signal-tier'

const VALID_SOLANA_MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'
const VALID_PUMP_MINT = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'

describe('contractButtons — dedicated unit suite', () => {
  it('returns empty keyboard for an empty contract', () => {
    expect(contractButtons('').inline_keyboard).toEqual([])
  })

  it('returns empty keyboard for an invalid non-base58 contract', () => {
    expect(contractButtons('invalid-mint-address!@#').inline_keyboard).toEqual([])
    expect(contractButtons('short').inline_keyboard).toEqual([])
  })

  it('returns empty keyboard for an unsupported chain', () => {
    expect(contractButtons(VALID_SOLANA_MINT, 'ethereum').inline_keyboard).toEqual([])
    expect(contractButtons(VALID_SOLANA_MINT, 'polygon').inline_keyboard).toEqual([])
  })

  it('every button URL contains the full mint for a standard mint', () => {
    const kb = contractButtons(VALID_SOLANA_MINT, 'solana')
    expect(kb.inline_keyboard.length).toBeGreaterThan(0)
    const flat = kb.inline_keyboard.flat()
    const encodedMint = encodeURIComponent(VALID_SOLANA_MINT)
    for (const b of flat) {
      expect(b.url).toContain(encodedMint)
    }
  })

  it('every button URL contains the full mint for a pump.fun mint', () => {
    const kb = contractButtons(VALID_PUMP_MINT, 'solana')
    expect(kb.inline_keyboard.length).toBeGreaterThan(0)
    const flat = kb.inline_keyboard.flat()
    const encodedMint = encodeURIComponent(VALID_PUMP_MINT)
    for (const b of flat) {
      expect(b.url).toContain(encodedMint)
    }
  })

  it('renders all 5 expected rows with proper labels and max 3 buttons per row', () => {
    const kb = contractButtons(VALID_SOLANA_MINT, 'solana')
    expect(kb.inline_keyboard.length).toBe(5)
    for (const row of kb.inline_keyboard) {
      expect(row.length).toBeLessThanOrEqual(3)
    }

    // Row 1: Axiom + Jupiter
    expect(kb.inline_keyboard[0][0].text).toBe('🟢 BUY Axiom')
    expect(kb.inline_keyboard[0][1].text).toBe('⚡ BUY Jupiter')

    // Row 2: Dexscreener + GMGN
    expect(kb.inline_keyboard[1][0].text).toBe('📊 Dexscreener')
    expect(kb.inline_keyboard[1][1].text).toBe('🔍 GMGN')

    // Row 3: Trojan + Phantom
    expect(kb.inline_keyboard[2][0].text).toBe('🐴 Trojan')
    expect(kb.inline_keyboard[2][1].text).toBe('👻 Phantom')

    // Row 4: Photon + BullX
    expect(kb.inline_keyboard[3][0].text).toBe('⚡ Photon')
    expect(kb.inline_keyboard[3][1].text).toBe('🐂 BullX')

    // Row 5: Maestro + Solscan
    expect(kb.inline_keyboard[4][0].text).toBe('🎩 Maestro')
    expect(kb.inline_keyboard[4][1].text).toBe('🔎 Solscan')
  })

  it('formats Trojan and Maestro deep links with the full mint as start param', () => {
    const kb = contractButtons(VALID_SOLANA_MINT, 'solana')
    const trojan = kb.inline_keyboard[2][0]
    const maestro = kb.inline_keyboard[4][0]
    expect(trojan.url).toBe(`https://t.me/solana_trojanbot?start=${encodeURIComponent(VALID_SOLANA_MINT)}`)
    expect(maestro.url).toBe(`https://t.me/maestro?start=${encodeURIComponent(VALID_SOLANA_MINT)}`)
  })

  it('formats Phantom deep-link with the jup swap URL containing the full mint', () => {
    const kb = contractButtons(VALID_SOLANA_MINT, 'solana')
    const phantom = kb.inline_keyboard[2][1]
    expect(phantom.url).toBe(`https://phantom.app/ul/browse/https://jup.ag/swap/SOL-${encodeURIComponent(VALID_SOLANA_MINT)}`)
  })

  it('formats Photon and BullX terminals carrying the full mint', () => {
    const kb = contractButtons(VALID_SOLANA_MINT, 'solana')
    const photon = kb.inline_keyboard[3][0]
    const bullx = kb.inline_keyboard[3][1]
    expect(photon.url).toBe(`https://photon-sol.tinyastro.io/en/lp/${encodeURIComponent(VALID_SOLANA_MINT)}`)
    expect(bullx.url).toBe(`https://bullx.io/terminal?chainId=1399811149&address=${encodeURIComponent(VALID_SOLANA_MINT)}`)
  })

  it('formats Solscan explorer with the full mint', () => {
    const kb = contractButtons(VALID_SOLANA_MINT, 'solana')
    const solscan = kb.inline_keyboard[4][1]
    expect(solscan.url).toBe(`https://solscan.io/token/${encodeURIComponent(VALID_SOLANA_MINT)}`)
  })
})
