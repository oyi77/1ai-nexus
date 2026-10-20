import { describe, it, expect } from 'vitest'
import {
  mergeWhaleRegistry,
  catchesFromScanRows,
  MAX_TOKENS_PER_WALLET,
  type WhaleWalletRecord,
  type WhaleIdentity,
  type WalletCatch,
} from '@/lib/modules/derived/whale-wallet-registry'
import type { WhaleBuyRow } from '@/lib/modules/derived/whale-buy-store'

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)

function row(over: Partial<WhaleBuyRow> = {}): WhaleBuyRow {
  return {
    contract: 'MintA',
    chain: 'solana',
    buyers: ['Whale1'],
    buyVolumeUsd: 20_000,
    buyCount: 1,
    firstBuyAt: NOW - 1000,
    lastBuyAt: NOW,
    ...over,
  }
}

function rec(over: Partial<WhaleWalletRecord> = {}): WhaleWalletRecord {
  return {
    address: 'Whale1',
    alias: 'Kang Rug',
    status: 'WHALE',
    winRate: 0.7,
    pnl30d: 1.2,
    labels: ['gmgn'],
    timesCaught: 3,
    firstCaughtAt: NOW - 10_000,
    lastCaughtAt: NOW - 5_000,
    tokens: ['OldMint'],
    sources: { 'whale-scan': 3 },
    ...over,
  }
}

function catchOf(over: Partial<WalletCatch> = {}): WalletCatch {
  return { address: 'Whale1', source: 'whale-scan', caughtAt: NOW, ...over }
}

describe('catchesFromScanRows', () => {
  it('emits one catch per buyer per row, carrying the contract', () => {
    const catches = catchesFromScanRows(
      [
        row({ contract: 'MintA', buyers: ['W1', 'W2'] }),
        row({ contract: 'MintB', buyers: ['W1'] }),
      ],
      NOW,
    )
    expect(catches).toHaveLength(3)
    expect(catches.filter((c) => c.address === 'W1').map((c) => c.token)).toEqual(['MintA', 'MintB'])
    expect(catches[0]).toMatchObject({ source: 'whale-scan', caughtAt: NOW })
  })

  it('skips empty buyer slots', () => {
    expect(catchesFromScanRows([row({ buyers: ['', 'W1'] })], NOW)).toHaveLength(1)
  })
})

describe('mergeWhaleRegistry', () => {
  it('creates a record for a first-time catch with source provenance', () => {
    const merged = mergeWhaleRegistry([], [catchOf({ token: 'MintA' })])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      address: 'Whale1',
      timesCaught: 1,
      firstCaughtAt: NOW,
      lastCaughtAt: NOW,
      tokens: ['MintA'],
      sources: { 'whale-scan': 1 },
    })
  })

  it('increments catches and prepends the new token for a known wallet', () => {
    const merged = mergeWhaleRegistry([rec()], [catchOf({ token: 'MintA' })])
    expect(merged[0].timesCaught).toBe(4)
    expect(merged[0].tokens).toEqual(['MintA', 'OldMint'])
    expect(merged[0].firstCaughtAt).toBe(NOW - 10_000)
    expect(merged[0].sources['whale-scan']).toBe(4)
  })

  it('records a NEW source without touching the existing one', () => {
    const merged = mergeWhaleRegistry([rec()], [catchOf({ source: 'axiom' })])
    expect(merged[0].sources).toEqual({ 'whale-scan': 3, axiom: 1 })
    expect(merged[0].timesCaught).toBe(4)
  })

  it('refreshes identity when supplied, keeps it when absent', () => {
    const identity: WhaleIdentity = {
      alias: 'New Alias',
      status: 'QUALIFIED_SMART_MONEY',
      winRate: 0.9,
      pnl30d: 2.5,
      labels: ['axiom'],
    }
    const withId = mergeWhaleRegistry([rec()], [catchOf({ identity })])
    expect(withId[0]).toMatchObject({ alias: 'New Alias', labels: ['axiom'] })

    const withoutId = mergeWhaleRegistry([rec()], [catchOf({ source: 'kolscan' })])
    expect(withoutId[0]).toMatchObject({ alias: 'Kang Rug', status: 'WHALE', labels: ['gmgn'] })
  })

  it('caps remembered tokens so the registry cannot grow without bound', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Mint${i}`)
    const merged = mergeWhaleRegistry([rec({ tokens: many })], [catchOf({ token: 'Fresh' })])
    expect(merged[0].tokens).toHaveLength(MAX_TOKENS_PER_WALLET)
    expect(merged[0].tokens[0]).toBe('Fresh')
  })

  it('never mutates the input records', () => {
    const existing = [rec({ tokens: ['OldMint'] })]
    mergeWhaleRegistry(existing, [catchOf({ token: 'MintA' })])
    expect(existing[0].tokens).toEqual(['OldMint'])
    expect(existing[0].timesCaught).toBe(3)
    expect(existing[0].sources).toEqual({ 'whale-scan': 3 })
  })

  it('re-catches the same token without duplicating it', () => {
    const merged = mergeWhaleRegistry([rec({ tokens: ['MintA'] })], [catchOf({ token: 'MintA' })])
    expect(merged[0].tokens).toEqual(['MintA'])
  })

  it('counts a catch with no token without dropping the token history', () => {
    const merged = mergeWhaleRegistry([rec({ tokens: ['MintA'] })], [catchOf({ source: 'kolscan' })])
    expect(merged[0].tokens).toEqual(['MintA'])
    expect(merged[0].sources).toEqual({ 'whale-scan': 3, kolscan: 1 })
  })

  it('bucket-counts a catch when the record predates provenance', () => {
    const legacy = { ...rec(), sources: undefined } as unknown as WhaleWalletRecord
    const merged = mergeWhaleRegistry([legacy], [catchOf({ source: 'axiom' })])
    // The pre-existing 3 catches are unattributed, so only the new one is named.
    expect(merged[0].sources).toEqual({ axiom: 1 })
  })
})
