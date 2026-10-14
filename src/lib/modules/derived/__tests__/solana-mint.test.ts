import { describe, expect, it } from 'vitest'
import { isWrappedSolMint, MALFORMED_SOL_MINT, normalizeSolMint } from '../solana-mint'
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
