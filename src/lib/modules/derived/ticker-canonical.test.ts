// Contract tests: Fase 4 ticker canonicalization.
// `$PUPPY` / `puppy ` / `PUPPY` must compare as one ticker; audit symbol
// mismatches and payload.ticker are judged on the canonical form.
import { describe, it, expect } from 'vitest'
import { canonicalTicker, toSniperPayload, type SniperEnrichedToken } from './sniper-source'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'

function token(over: Partial<SniperEnrichedToken> = {}): SniperEnrichedToken {
  return {
    id: 'solana:AAA',
    platform: 'dexscreener',
    chain: 'solana',
    contract: 'AAA',
    symbol: 'AAA',
    name: 'AAA',
    price: 0,
    change24h: 0,
    volume24h: 500_000,
    marketCap: 1_000_000,
    liquidity: 100_000,
    createdAt: null,
    riskLevel: 0,
    holders: 1000,
    top10HolderPercent: 0,
    social: {},
    audited: false,
    ...over,
  }
}

function audit(over: Partial<MemeRiskAudit> = {}): MemeRiskAudit {
  return {
    id: 'x',
    platform: 'rugcheck',
    chain: 'solana',
    contract: 'AAA',
    symbol: '',
    canMint: false,
    canFreeze: false,
    isHoneypot: false,
    lpBurnedPercent: -1,
    lpLockedPercent: -1,
    top10HolderPercent: 0,
    ...over,
  } as MemeRiskAudit
}

describe('canonicalTicker', () => {
  it('strips $, trims, and uppercases', () => {
    expect(canonicalTicker('$PUPPY')).toBe('PUPPY')
    expect(canonicalTicker('  puppy  ')).toBe('PUPPY')
    expect(canonicalTicker('PUPPY')).toBe('PUPPY')
  })

  it('handles empty/missing without throwing', () => {
    expect(canonicalTicker('')).toBe('')
    expect(canonicalTicker(undefined)).toBe('')
    expect(canonicalTicker('$')).toBe('')
  })
})

describe('toSniperPayload canonical ticker', () => {
  it('emits canonical ticker (no $ prefix)', () => {
    const { payload } = toSniperPayload(token({ symbol: '$PUPPY' }), [])
    expect(payload.ticker).toBe('PUPPY')
  })

  it('treats $-prefixed audit symbol as agreeing (no false mismatch)', () => {
    const { warnings, auditsAccepted } = toSniperPayload(token({ symbol: 'PUPPY' }), [
      audit({ contract: 'AAA', symbol: '$puppy', lpLockedPercent: 0.9 }),
    ])
    expect(auditsAccepted).toHaveLength(1)
    expect(warnings.some((w) => w.includes('symbol mismatch'))).toBe(false)
  })

  it('still flags a genuine ticker disagreement after canonicalization', () => {
    const { warnings } = toSniperPayload(token({ symbol: 'PUPPY' }), [
      audit({ contract: 'AAA', symbol: 'BONK' }),
    ])
    expect(warnings.some((w) => w.includes('symbol mismatch'))).toBe(true)
  })
})
