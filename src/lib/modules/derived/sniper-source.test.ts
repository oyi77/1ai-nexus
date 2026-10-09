// Contract tests: sniper-source mapping — audits → SniperPayload.
// Fixture-driven merge semantics; the live scan pipeline (network) is
// covered by sniper-scan.test.ts with injected deps.
import { describe, it, expect } from 'vitest'
import { toSniperPayload, type SniperEnrichedToken } from './sniper-source'
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
    createdAt: Date.now() - 30 * 60_000,
    riskLevel: 0,
    holders: 1000,
    top10HolderPercent: 0,
    social: {},
    audited: false,
    volume5m: 3_000_000,
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
    name: '',
    riskLevel: 0,
    riskLabel: 'safe',
    buyTax: 0,
    sellTax: 0,
    top10HolderPercent: 0.18, // fraction
    lpLockedPercent: -1,
    canFreeze: false,
    canMint: false,
    isHoneypot: false,
    riskCounts: { high: 0, middle: 0, low: 0 },
    auditedAt: Date.now(),
    ...over,
  }
}

describe('sniper-source mapping', () => {
  it('maps a clean rugcheck+rugged-proof audit to a passable payload', () => {
    const p = toSniperPayload(
      token(),
      [audit({ lpLockedPercent: 1, topWallets: [{ address: 'A', percent: 0.05 }] })],
    )
    expect(p.security).toMatchObject({ mintable: false, freezeAuthority: false, honeypot: false })
    expect(p.security.lpLockedPercent).toBe(100)
    expect(p.security.lpBurnedPercent).toBeNull() // never claimed
    expect(p.distribution.top10Percent).toBe(18)
    expect(p.momentum.volume5m).toBe(3_000_000)
    expect(p.momentum.top5AvgPnlPercent).toBeNull()
  })

  it('ignores birdeye mint/freeze falses (static catalog, unknowable)', () => {
    // Birdeye returns static-check flags that prove nothing — they must not
    // launder a rugcheck-proven mint into "mintable: false".
    const p = toSniperPayload(token(), [
      audit({ platform: 'birdeye', canMint: false, canFreeze: false, isHoneypot: false, top10HolderPercent: 0, lpLockedPercent: -1 }),
      audit({ canMint: true, canFreeze: false, isHoneypot: false }),
    ])
    expect(p.security.mintable).toBe(true)
    expect(p.security.freezeAuthority).toBe(false)
  })

  it('treats a fully-untrusted audit set as unproven, never safe', () => {
    const p = toSniperPayload(token(), [
      audit({ platform: 'birdeye', canMint: false, canFreeze: false, isHoneypot: false, top10HolderPercent: 0, lpLockedPercent: -1 }),
    ])
    expect(p.security.mintable).toBeNull()
    expect(p.security.freezeAuthority).toBeNull()
    expect(p.security.honeypot).toBeNull()
  })

  it('merges disjunctively: any bad fact from any source wins', () => {
    const p = toSniperPayload(token(), [
      audit({ canMint: false, canFreeze: false, isHoneypot: false }),
      audit({
        platform: 'rugcheck',
        canMint: true, // one trusted source proves mint
        canFreeze: false,
        isHoneypot: false,
        top10HolderPercent: 0,
        lpLockedPercent: -1,
        distribution: { devPercent: 0.02, sniperPercent: 0.01 }, // fractions
      }),
    ])
    expect(p.security.mintable).toBe(true)
    expect(p.security.freezeAuthority).toBe(false)
    expect(p.distribution.devPercent).toBe(2)
    expect(p.distribution.sniperPercent).toBe(1)
    expect(p.distribution.bundlerPercent).toBeNull()
  })

  it('takes the worst concentration and the best LP lock', () => {
    const p = toSniperPayload(token(), [
      audit({ top10HolderPercent: 0.2, lpLockedPercent: 0.6 }),
      audit({ platform: 'gmgn', top10HolderPercent: 0.35, lpLockedPercent: 0.9 }),
    ])
    expect(p.distribution.top10Percent).toBe(35)
    expect(p.security.lpLockedPercent).toBe(90)
  })

  it('treats absent fields as unproven null, never safe', () => {
    const p = toSniperPayload(token(), [])
    expect(p.security.mintable).toBeNull()
    expect(p.security.lpLockedPercent).toBeNull()
    expect(p.distribution.devPercent).toBeNull()
    expect(p.distribution.top10Percent).toBeNull()
  })

  it('passes through GMGN top-holder addresses with kind holder', () => {
    const p = toSniperPayload(
      token(),
      [audit({ topWallets: [{ address: 'Dev1', percent: 0.09 }, { address: 'H2', percent: 0.04 }] })],
    )
    expect(p.distribution.topWallets).toEqual([
      { address: 'Dev1', percent: 9, kind: 'holder' },
      { address: 'H2', percent: 4, kind: 'holder' },
    ])
  })

  it('routes unknown age to post-bonding gates (strict), never new-pair', () => {
    const young = toSniperPayload(token({ createdAt: null }), [])
    expect(young.ageMinutes).toBeGreaterThan(10_000 - 1)
  })
})
