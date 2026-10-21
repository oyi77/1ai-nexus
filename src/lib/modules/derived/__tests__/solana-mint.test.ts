import { describe, expect, it } from 'vitest'
import { b58DecodeLen, isPlausibleSolMint, isWrappedSolMint, MALFORMED_SOL_MINT, normalizeSolMint } from '../solana-mint'
import { SOL_MINT } from '../solana-harvest'
import { mapGmgnActivityToSwap, type GmgnActivityRow } from '../wallet-activity'

const WALLET = '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9'
const NOW = 1_800_000_000_000
// Real 43-char base58 token mint (mSOL) that is NOT the malformed SOL
// near-miss and must stay untouched.
const ARBITRARY_43 = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'

describe('normalizeSolMint — exact near-miss only, never arbitrary strings', () => {
  it('maps the exact observed 43-char GMGN near-miss to canonical wrapped SOL', () => {
    expect(MALFORMED_SOL_MINT.length).toBe(43)
    expect(normalizeSolMint(MALFORMED_SOL_MINT)).toBe(SOL_MINT)
  })

  it('keeps the canonical wrapped-SOL mint unchanged (idempotent)', () => {
    expect(SOL_MINT.length).toBe(43)
    expect(normalizeSolMint(SOL_MINT)).toBe(SOL_MINT)
    expect(normalizeSolMint(normalizeSolMint(SOL_MINT))).toBe(SOL_MINT)
  })

  it('leaves any other 43-char base58 string untouched', () => {
    expect(ARBITRARY_43.length).toBe(43)
    expect(normalizeSolMint(ARBITRARY_43)).toBe(ARBITRARY_43)
  })

  it('leaves arbitrary strings untouched', () => {
    expect(normalizeSolMint('So1111111111111111111111111111111111111111')).toBe(
      'So1111111111111111111111111111111111111111',
    )
    expect(normalizeSolMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    )
  })

  it('leaves the empty string untouched', () => {
    expect(normalizeSolMint('')).toBe('')
  })
})

describe('isWrappedSolMint — canonical only', () => {
  it('is true for the canonical wrapped-SOL mint only', () => {
    expect(isWrappedSolMint(SOL_MINT)).toBe(true)
    expect(isWrappedSolMint(MALFORMED_SOL_MINT)).toBe(false)
    expect(isWrappedSolMint(ARBITRARY_43)).toBe(false)
    expect(isWrappedSolMint('')).toBe(false)
  })
})

describe('GMGN row mapping applies the normalizer before classifyBuy', () => {
  it('maps a buy row carrying the malformed SOL quote to canonical SOL inputMint', () => {
    const row: GmgnActivityRow = {
      tx_hash: 'sig-malformed-sol',
      timestamp: 1_791_951_396,
      event_type: 'buy',
      token: { address: 'CNMVS8E419EaRDQkj36weSirhDXjRSVfaZJZCJMppump', symbol: 'OR' },
      token_amount: '2140272.598867',
      quote_amount: '0.244444443',
      cost_usd: '26.29244428908',
      quote_token: { token_address: MALFORMED_SOL_MINT, symbol: 'SOL', decimals: 9 },
      quote_address: MALFORMED_SOL_MINT,
      gas_native: '0.000505',
      gas_usd: '0.05430265',
    }
    const swap = mapGmgnActivityToSwap(WALLET, row, NOW)
    expect(swap.completeness).toBe('complete')
    expect(swap.inputMint).toBe(SOL_MINT)
    expect(swap.outputMint).toBe('CNMVS8E419EaRDQkj36weSirhDXjRSVfaZJZCJMppump')
    expect(swap.inputUsd).toBeCloseTo(26.29244428908, 6)
  })

  it('does not weaken the sell side: malformed SOL quote normalizes, token leg stays token', () => {
    const row: GmgnActivityRow = {
      tx_hash: 'sig-malformed-sell',
      timestamp: 1_791_951_396,
      event_type: 'sell',
      token: { address: 'CNMVS8E419EaRDQkj36weSirhDXjRSVfaZJZCJMppump', symbol: 'OR' },
      token_amount: '2140272.598867',
      quote_amount: '0.244444443',
      cost_usd: '26.29244428908',
      quote_token: { token_address: MALFORMED_SOL_MINT, symbol: 'SOL', decimals: 9 },
      quote_address: MALFORMED_SOL_MINT,
    }
    const swap = mapGmgnActivityToSwap(WALLET, row, NOW)
    expect(swap.inputMint).toBe('CNMVS8E419EaRDQkj36weSirhDXjRSVfaZJZCJMppump')
    expect(swap.outputMint).toBe(SOL_MINT)
  })
})

describe('isPlausibleSolMint — measured 2026-10-22 over the whole store', () => {
  // Lengths of the 6,513 stored pump contracts: 29, 30 and 31 bytes. The two
  // 31-byte rows are genuine mints, so the gate cannot cut below 31.
  const REAL_29 = 'CWHunzmc7p7HYpbRvauduXZ66mfBFwEybkQHwNZ5pump'
  const REAL_31 = '3AFVt63G4m7qXuCPGeMCDsZqJFDo8SBeza7GMbBzfypump'
  // The welded shape: a real mint with the tail of an encoded ':' glued on.
  const WELDED_46 = '3ACWHunzmc7p7HYpbRvauduXZ66mfBFwEybkQHwNZ5pump'

  it('decodes byte length exactly, counting leading zero bytes', () => {
    expect(b58DecodeLen(REAL_29.slice(0, -4))).toBe(29)
    expect(b58DecodeLen(REAL_31.slice(0, -4))).toBe(31)
    expect(b58DecodeLen(WELDED_46.slice(0, -4))).toBe(31)
    expect(b58DecodeLen('1')).toBe(1)
    expect(b58DecodeLen('0OIl')).toBeNull()
  })

  it('accepts the real mints at every measured length, 3A prefix included', () => {
    expect(isPlausibleSolMint(REAL_29)).toBe(true)
    expect(isPlausibleSolMint(REAL_31)).toBe(true)
  })

  it('does not pretend length can separate the welded row from a real 31-byte mint', () => {
    // Both measure 31 bytes; only the source message distinguishes them.
    // Refusing here would drop a genuine mint, which is the worse failure, so
    // the reader keeps it and the extractor is what has to stop producing it.
    expect(b58DecodeLen(WELDED_46.slice(0, -4))).toBe(b58DecodeLen(REAL_31.slice(0, -4)))
    expect(isPlausibleSolMint(WELDED_46)).toBe(true)
  })

  it('rejects bodies past 31 bytes, non-base58 and non-pump values', () => {
    expect(b58DecodeLen('A'.repeat(45))).toBe(33)
    expect(isPlausibleSolMint('A'.repeat(45) + 'pump')).toBe(false)
    expect(isPlausibleSolMint('')).toBe(false)
    expect(isPlausibleSolMint('garbage')).toBe(false)
    expect(isPlausibleSolMint('0OIl' + 'pump')).toBe(false)
    expect(isPlausibleSolMint(REAL_29.slice(0, -4))).toBe(false)
  })

  it('refuses word-shaped values that merely end in pump', () => {
    // Measured live: `jonathanpump` (6-byte body) reached the feed as a
    // candidate with no trading pair, and `gptpump` is the same class. Real
    // pump mints never decode below 29 bytes.
    expect(b58DecodeLen('jonathan')).toBe(6)
    expect(isPlausibleSolMint('jonathanpump')).toBe(false)
    expect(isPlausibleSolMint('gptpump')).toBe(false)
  })
})
