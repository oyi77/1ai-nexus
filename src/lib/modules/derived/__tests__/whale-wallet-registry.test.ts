import { describe, it, expect } from 'vitest'
import {
  mergeWhaleRegistry,
  MAX_TOKENS_PER_WALLET,
  type WhaleWalletRecord,
  type WhaleIdentity,
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
    ...over,
  }
}

describe('mergeWhaleRegistry', () => {
  it('creates a record for a first-time buyer', () => {
    const merged = mergeWhaleRegistry([], [row()], new Map(), NOW)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      address: 'Whale1',
      timesCaught: 1,
      firstCaughtAt: NOW,
      lastCaughtAt: NOW,
      tokens: ['MintA'],
    })
  })

  it('increments catches and prepends the new token for a known wallet', () => {
    const merged = mergeWhaleRegistry([rec()], [row()], new Map(), NOW)
    expect(merged[0].timesCaught).toBe(4)
    expect(merged[0].tokens).toEqual(['MintA', 'OldMint'])
    expect(merged[0].firstCaughtAt).toBe(NOW - 10_000)
    expect(merged[0].lastCaughtAt).toBe(NOW)
  })

  it('refreshes identity when known, and keeps the old one when unknown', () => {
    const identity: WhaleIdentity = {
      alias: 'New Alias',
      status: 'QUALIFIED_SMART_MONEY',
      winRate: 0.9,
      pnl30d: 2.5,
      labels: ['axiom'],
    }
    const withIdentity = mergeWhaleRegistry([rec()], [row()], new Map([['Whale1', identity]]), NOW)
    expect(withIdentity[0]).toMatchObject({ alias: 'New Alias', status: 'QUALIFIED_SMART_MONEY', labels: ['axiom'] })

    const withoutIdentity = mergeWhaleRegistry([rec()], [row()], new Map(), NOW)
    expect(withoutIdentity[0]).toMatchObject({ alias: 'Kang Rug', status: 'WHALE', labels: ['gmgn'] })
  })

  it('caps remembered tokens so the registry cannot grow without bound', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Mint${i}`)
    const merged = mergeWhaleRegistry([rec({ tokens: many })], [row({ contract: 'Fresh' })], new Map(), NOW)
    expect(merged[0].tokens).toHaveLength(MAX_TOKENS_PER_WALLET)
    expect(merged[0].tokens[0]).toBe('Fresh')
  })

  it('counts one catch per buyer per row and never mutates the input', () => {
    const existing = [rec({ tokens: ['OldMint'] })]
    const merged = mergeWhaleRegistry(
      existing,
      [row({ contract: 'MintA', buyers: ['Whale1', 'Whale2'] })],
      new Map(),
      NOW,
    )
    expect(existing[0].tokens).toEqual(['OldMint'])
    expect(existing[0].timesCaught).toBe(3)
    expect(merged.find((r) => r.address === 'Whale2')?.timesCaught).toBe(1)
  })

  it('re-catches the same token without duplicating it', () => {
    const merged = mergeWhaleRegistry([rec({ tokens: ['MintA'] })], [row({ contract: 'MintA' })], new Map(), NOW)
    expect(merged[0].tokens).toEqual(['MintA'])
  })
})
