// ─────────────────────────────────────────────────────────────
// Whale harvester unit tests (pure parts only — no network/DB/sheet).
// Covers: mergeHarvest, toSheetRow, toPersistWallet.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  mergeHarvest,
  toSheetRow,
  toPersistWallet,
  type HarvestedWallet,
} from '../whale-harvester'

function wallet(over: Partial<HarvestedWallet> = {}): HarvestedWallet {
  return {
    address: 'A'.repeat(40),
    name: '',
    source: 'gmgn',
    winRate30d: 0.64,
    pnl30d: 0.3,
    realizedProfit30d: null,
    buyVolume30d: null,
    ...over,
  }
}

describe('mergeHarvest', () => {
  it('dedupes overlapping addresses across batches, keeping the row with more non-null stats', () => {
    const addr = 'A'.repeat(40)
    const sparse = wallet({ address: addr, source: 'gmgn', winRate30d: 0.6, pnl30d: null })
    const rich = wallet({ address: addr, source: 'kolscan', winRate30d: null, pnl30d: 0.2, realizedProfit30d: 1200 })

    const merged = mergeHarvest([sparse], [rich])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(rich)
  })

  it('breaks equal non-null stat ties by lexicographically smallest source', () => {
    const addr = 'B'.repeat(40)
    const fromKol = wallet({ address: addr, source: 'kolscan', winRate30d: null, pnl30d: 0.1, realizedProfit30d: 50 })
    const fromGmgn = wallet({ address: addr, source: 'gmgn', winRate30d: 0.5, pnl30d: null, realizedProfit30d: 60 })

    // gmgn < kolscan → the gmgn row wins the tie.
    expect(mergeHarvest([fromKol], [fromGmgn])[0]).toEqual(fromGmgn)
  })

  it('is deterministic regardless of batch order', () => {
    const addr = 'C'.repeat(40)
    const a = wallet({ address: addr, source: 'gmgn', winRate30d: 0.5, pnl30d: 0.1 })
    const b = wallet({ address: addr, source: 'gmgn', winRate30d: 0.6, pnl30d: null })

    const forward = mergeHarvest([a], [b])
    const reverse = mergeHarvest([b], [a])
    expect(forward).toHaveLength(1)
    expect(forward[0]).toEqual(reverse[0])
  })
})

describe('toSheetRow', () => {
  it('formats gmgn rows with verification as GMGN-{kind} wr=64% pnl=+30%', () => {
    expect(toSheetRow(wallet({ winRate30d: 0.64, pnl30d: 0.3, verification: 'WHALE' })).name).toBe(
      'GMGN-WHALE wr=64% pnl=+30%',
    )
    expect(
      toSheetRow(wallet({ winRate30d: 0.64, pnl30d: 0.3, verification: 'QUALITY' })).name,
    ).toBe('GMGN-QUALITY wr=64% pnl=+30%')
  })

  it('renders n/a for null stats and UNVERIFIED when verification is absent', () => {
    expect(toSheetRow(wallet({ winRate30d: null, pnl30d: null })).name).toBe('GMGN-UNVERIFIED wr=n/a pnl=n/a')
  })

  it('formats kolscan rows as KOLSCAN {name}', () => {
    expect(toSheetRow(wallet({ source: 'kolscan', name: 'Kang Rug' })).name).toBe('KOLSCAN Kang Rug')
  })

  it('falls back to short address when kolscan name is empty', () => {
    expect(toSheetRow(wallet({ source: 'kolscan', name: '', address: 'AbCdEfGh123456' })).name).toBe(
      'KOLSCAN AbCdEfGh',
    )
  })

  it('caps names below 80 chars', () => {
    const row = toSheetRow(wallet({ source: 'kolscan', name: 'X'.repeat(200) }))
    expect(row.name.length).toBeLessThan(80)
  })
})

describe('toPersistWallet', () => {
  it('maps gmgn rows to gmgn verification labels + whale-verification and formatted alias', () => {
    const persisted = toPersistWallet(
      wallet({ source: 'smart_degen', winRate30d: 0.64, pnl30d: 0.3, verification: 'WHALE' }),
    )
    expect(persisted.address).toBe('A'.repeat(40))
    expect(persisted.chain).toBe('solana')
    expect(persisted.labels).toEqual(['gmgn', 'whale', 'whale-verification'])
    expect(persisted.alias).toBe('GMGN-WHALE wr=64% pnl=+30%')
  })

  it('maps unverified gmgn rows to unverified labels', () => {
    const persisted = toPersistWallet(wallet({ source: 'smart_degen', winRate30d: 0.64, pnl30d: 0.3 }))
    expect(persisted.labels).toEqual(['gmgn', 'unverified', 'whale-verification'])
    expect(persisted.alias).toBe('GMGN-UNVERIFIED wr=64% pnl=+30%')
  })

  it('maps kolscan rows to kolscan labels and the KOLSCAN alias', () => {
    const persisted = toPersistWallet(wallet({ source: 'kolscan', name: 'Kang Rug' }))
    expect(persisted.labels).toEqual(['kolscan', 'whale-harvest'])
    expect(persisted.alias).toBe('KOLSCAN Kang Rug')
  })
})
