import { describe, it, expect } from 'vitest'
import { formatPotentialCoinSignal } from '../signal-tier'
import type { SniperPayload } from '../meme-sniper'
import type { SmartMoneyEvidence } from '../smart-money-provider'

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

function evidence(over: Partial<SmartMoneyEvidence> = {}): SmartMoneyEvidence {
  return {
    contract: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    buyers: [
      {
        walletId: 'w1',
        address: 'Addr1',
        alias: null,
        status: 'QUALIFIED_SMART_MONEY',
        pnl30d: 1.2,
        winRate: 0.7,
        sampleCount: 20,
        classifiedAt: new Date(),
        holdingUsd: 5000,
        stale: false,
      },
    ],
    walletsHolding: 1,
    byStatus: { QUALIFIED_SMART_MONEY: 1 },
    strongest: 'QUALIFIED_SMART_MONEY',
    bullishHoldingUsd: 5000,
    ttlMs: 1000,
    source: 'wallet-db:smartMoneyWallet',
    ...over,
  }
}

describe('formatPotentialCoinSignal', () => {
  it('renders the exact POTENTIAL COIN SIGNAL title', () => {
    const out = formatPotentialCoinSignal({
      payload: payload(),
      tier: 'CANDIDATE',
      tierReasons: ['screening passed but essential evidence is missing'],
      tierMissing: ['no classified wallet holds this token'],
      smartMoney: evidence(),
      marketCapUsd: 250_000,
      liquidityUsd: 50_000,
      volumeUsd: 60_000,
    })
    expect(out.text).toContain('<b>POTENTIAL COIN SIGNAL</b>')
    expect(out.text).toContain('CANDIDATE')
  })

  it('renders n/a for null market cap and liquidity without crashing', () => {
    const out = formatPotentialCoinSignal({
      payload: payload({ momentum: { marketCap: null, volume5m: null } }),
      tier: 'CANDIDATE',
      tierReasons: [],
      tierMissing: [],
      smartMoney: evidence({ buyers: [] }),
      marketCapUsd: null,
      liquidityUsd: null,
      volumeUsd: null,
    })
    expect(out.text).toContain('Market Cap: n/a')
    expect(out.text).toContain('Liquidity: n/a')
  })

  it('renders per-check PASS/UNKNOWN verdicts from tierReasons + tierMissing', () => {
    const out = formatPotentialCoinSignal({
      payload: payload(),
      tier: 'CANDIDATE',
      tierReasons: ['clean screen at 2.50x volume', 'security failure: mint authority on'],
      tierMissing: ['wallet evidence unavailable'],
      smartMoney: evidence(),
      marketCapUsd: 250_000,
      liquidityUsd: 50_000,
    })
    expect(out.text).toContain('[PASS] clean screen')
    expect(out.text).toContain('[FAIL] security failure')
    expect(out.text).toContain('[UNKNOWN] wallet evidence unavailable')
  })

  it('always includes SHADOW banner and explicit alert ≠ entry disclaimer', () => {
    const out = formatPotentialCoinSignal({
      payload: payload(),
      tier: 'CANDIDATE',
      tierReasons: [],
      tierMissing: [],
      smartMoney: evidence(),
      marketCapUsd: 250_000,
      liquidityUsd: 50_000,
    })
    expect(out.text).toContain('STATUS: SHADOW (PAPER)')
    expect(out.text).toContain('alert ≠ entry')
  })

  it('escapes dynamic fields so no raw < from input survives', () => {
    const out = formatPotentialCoinSignal({
      payload: payload({
        ticker: '<TICK>',
        contract: 'So11111111111111111111111111111111111111112',
        chain: '<chain>',
      }),
      tier: 'CANDIDATE',
      tierReasons: ['<script>alert(1)</script>'],
      tierMissing: ['<missing>'],
      smartMoney: evidence(),
      marketCapUsd: 250_000,
      liquidityUsd: 50_000,
      risks: ['<risk>'],
    })
    expect(out.text).not.toContain('<script>')
    expect(out.text).not.toContain('<TICK>')
    expect(out.text).not.toContain('<risk>')
    expect(out.text).toContain('&lt;script&gt;')
    expect(out.text).toContain('&lt;TICK&gt;')
  })

  it('stays under Telegram 4096 chars and attaches buttons by default', () => {
    const out = formatPotentialCoinSignal({
      payload: payload(),
      tier: 'CANDIDATE',
      tierReasons: ['clean screen at 2.50x volume'],
      tierMissing: [],
      smartMoney: evidence(),
      marketCapUsd: 250_000,
      liquidityUsd: 50_000,
    })
    expect(out.text.length).toBeLessThan(4096)
    expect(out.replyMarkup).toBeDefined()
    expect(out.replyMarkup!.inline_keyboard.flat().every((b) => b.url.startsWith('https://'))).toBe(true)
  })

  it('omits buttons when sendButtons is false', () => {
    const out = formatPotentialCoinSignal({
      payload: payload(),
      tier: 'CANDIDATE',
      tierReasons: [],
      tierMissing: [],
      smartMoney: evidence(),
      marketCapUsd: 250_000,
      liquidityUsd: 50_000,
      sendButtons: false,
    })
    expect(out.replyMarkup).toBeUndefined()
  })
})
