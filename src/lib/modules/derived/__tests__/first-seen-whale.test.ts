import { describe, expect, it } from 'vitest'
import {
  detectFirstSeenWhale,
  FIRST_SEEN_WHALE_DEFAULT_MIN_USD,
  toFirstSeenWalletRows,
  type BuyLeg,
} from '../first-seen-whale'

const MINT_A = '7tZt1LXb9vXq2pVvU4s9dK3mN1wR5tY6uE8iO0pA2sD'
const MINT_B = 'Diy4Q5aiVzDgEVz7eYkMzUPjUy2KwHzCnCLYxUBQH5'
const WHALE_NEW = 'whaleNEW1111111111111111111111111111111111111'
const WHALE_NEW2 = 'whaleNEW2222222222222222222222222222222222222'
const TRACKED = 'tracked999999999999999999999999999999999999999'

const NOW = 1_700_000_000_000

function leg(over: Partial<BuyLeg> = {}): BuyLeg {
  return {
    wallet: WHALE_NEW,
    contract: MINT_A,
    chain: 'solana',
    usd: 15_000,
    timestamp: NOW,
    ...over,
  }
}

describe('detectFirstSeenWhale — never-tracked wallets only', () => {
  it('flags a buy above the threshold from an unknown wallet', () => {
    const out = detectFirstSeenWhale([leg()], new Set())
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      wallet: WHALE_NEW,
      contract: MINT_A,
      chain: 'solana',
      usd: 15_000,
      source: 'first-seen-whale',
    })
  })

  it('never flags a wallet that is in the known set (even unclassified)', () => {
    const out = detectFirstSeenWhale([leg({ wallet: TRACKED })], new Set([TRACKED]))
    expect(out).toEqual([])
  })

  it('skips legs below the USD threshold', () => {
    const out = detectFirstSeenWhale([leg({ usd: 9_999 })], new Set())
    expect(out).toEqual([])
  })

  it('skips legs with invalid USD — NEVER fabricates a zero-dollar signal', () => {
    const out = detectFirstSeenWhale(
      [leg({ usd: NaN }), leg({ usd: 0 }), leg({ usd: -100 }), leg({ usd: Infinity })],
      new Set(),
    )
    expect(out).toEqual([])
  })

  it('skips legs with missing wallet / contract / chain', () => {
    const out = detectFirstSeenWhale(
      [leg({ wallet: '' }), leg({ contract: '' }), leg({ chain: '' })],
      new Set(),
    )
    expect(out).toEqual([])
  })

  it('dedups by (wallet, contract) keeping the largest leg', () => {
    const out = detectFirstSeenWhale(
      [leg({ usd: 12_000 }), leg({ usd: 25_000 }), leg({ usd: 10_500 })],
      new Set(),
    )
    expect(out).toHaveLength(1)
    expect(out[0].usd).toBe(25_000)
  })

  it('keeps separate signals per contract for the same wallet', () => {
    const out = detectFirstSeenWhale(
      [leg({ contract: MINT_A }), leg({ contract: MINT_B })],
      new Set(),
    )
    expect(out).toHaveLength(2)
  })

  it('sorts by USD descending — largest whale first', () => {
    const out = detectFirstSeenWhale(
      [leg({ wallet: WHALE_NEW, usd: 11_000 }), leg({ wallet: WHALE_NEW2, usd: 50_000 })],
      new Set(),
    )
    expect(out.map((s) => s.wallet)).toEqual([WHALE_NEW2, WHALE_NEW])
  })

  it('respects a custom minUsd override', () => {
    const low = detectFirstSeenWhale([leg({ usd: 5_000 })], new Set(), { minUsd: 1_000 })
    expect(low).toHaveLength(1)
    const high = detectFirstSeenWhale([leg({ usd: 5_000 })], new Set(), { minUsd: 100_000 })
    expect(high).toEqual([])
  })

  it('default threshold is $10k', () => {
    expect(FIRST_SEEN_WHALE_DEFAULT_MIN_USD).toBe(10_000)
  })
})

describe('toFirstSeenWalletRows — Wallet upsert rows', () => {
  it('dedups signals to one row per wallet', () => {
    const signals = detectFirstSeenWhale(
      [leg({ contract: MINT_A }), leg({ contract: MINT_B })],
      new Set(),
    )
    const rows = toFirstSeenWalletRows(signals)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      address: WHALE_NEW,
      chain: 'solana',
      labels: ['first-seen-whale', 'whale-lead'],
    })
  })

  it('returns empty for empty signals', () => {
    expect(toFirstSeenWalletRows([])).toEqual([])
  })
})
