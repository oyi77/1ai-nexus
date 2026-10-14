// ─────────────────────────────────────────────────────────────
// Whale harvester unit tests (pure parts only — no network/DB/sheet).
// Covers: mergeHarvest, toSheetRow, toPersistWallet, filterVerifiedWhales,
// WHALE_HARVEST_TAGS.
//
// harvestGmgnWallets / harvestGmgnWalletsMultiWindow are NOT unit-tested:
// they call the live GMGN endpoint with an internal sleep. Their merge
// semantics mirror `mergeHarvest` (same scorer) and their gate is exactly
// `filterVerifiedWhales` — integration proved by the daily cron + before/
// after DB counts reported at commit time.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  WHALE_HARVEST_TAGS,
  filterVerifiedWhales,
  mergeHarvest,
  mergeRowGmgn,
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

describe('mergeRowGmgn', () => {
  it('keeps the best measured row when a wallet appears in several windows', () => {
    const addr = 'D'.repeat(40)
    const from1d = wallet({
      address: addr,
      source: 'sniper',
      pnl30d: 9.9,
      winRate30d: 0.95,
      realizedProfit30d: 250_000,
      windows: ['1d'],
    })
    const from30d = wallet({
      address: addr,
      source: 'whale',
      pnl30d: 0.1,
      winRate30d: 0.2,
      realizedProfit30d: 1_000,
      windows: ['30d'],
    })

    // Existing row is 30d (lower score); candidate is 1d (higher score).
    const merged = mergeRowGmgn(from30d, from1d)
    expect(merged.realizedProfit30d).toBe(250_000)
    expect(merged.winRate30d).toBe(0.95)
    // First-seen source keeps ownership; candidate only supplies stats.
    expect(merged.source).toBe('whale')
  })

  it('records every window the wallet was seen in, without duplicates', () => {
    const addr = 'E'.repeat(40)
    const first = wallet({ address: addr, source: 'kol', windows: ['1d'] })
    const second = mergeRowGmgn(first, wallet({ address: addr, source: 'kol', windows: ['7d'] }))
    const third = mergeRowGmgn(second, wallet({ address: addr, source: 'kol', windows: ['30d'] }))
    const again = mergeRowGmgn(third, wallet({ address: addr, source: 'kol', windows: ['1d'] }))

    expect(again.windows).toEqual(['1d', '7d', '30d'])
  })

  it('keeps the existing row when the incoming row is not better', () => {
    const addr = 'F'.repeat(40)
    const existing = wallet({ address: addr, source: 'whale', winRate30d: 0.8, pnl30d: 1.5, windows: ['30d'] })
    const worse = wallet({ address: addr, source: 'sniper', winRate30d: 0.1, pnl30d: 0.05, windows: ['1d'] })

    const merged = mergeRowGmgn(existing, worse)
    expect(merged.winRate30d).toBe(0.8)
    expect(merged.pnl30d).toBe(1.5)
    expect(merged.source).toBe('whale')
    expect(merged.windows).toEqual(['30d', '1d'])
  })
})

describe('filterVerifiedWhales', () => {
  it('labels the whale-volume leg WHALE and the quality leg QUALITY', () => {
    const whale = wallet({
      address: 'W'.repeat(40),
      winRate30d: 0.5,
      pnl30d: 0.2,
      buyVolume30d: 400_000,
    })
    const quality = wallet({
      address: 'Q'.repeat(40),
      winRate30d: 0.65,
      pnl30d: 0.9,
      buyVolume30d: 1_000,
    })

    const out = filterVerifiedWhales([whale, quality])
    expect(out.map((w) => w.verification)).toEqual(['WHALE', 'QUALITY'])
  })

  it('excludes below-bar rows, unmeasured rows, and the wr=0 pnl=0 noise case', () => {
    const belowBars = wallet({ address: 'X'.repeat(40), winRate30d: 0.3, pnl30d: 0.1 })
    const unmeasured = wallet({ address: 'Y'.repeat(40), winRate30d: null, pnl30d: null })
    const noise = wallet({ address: 'Z'.repeat(40), winRate30d: 0, pnl30d: 0 })

    expect(filterVerifiedWhales([belowBars, unmeasured, noise])).toEqual([])
  })
})

describe('WHALE_HARVEST_TAGS', () => {
  it('appends the photon/bullx trader tags without reordering the original 12', () => {
    expect(WHALE_HARVEST_TAGS.slice(0, 12)).toEqual([
      'smart_degen',
      'pump_smart_degen',
      'sniper',
      'kol',
      'axiom',
      'whale',
      'launchpad_smart',
      'top_followed',
      'wash_trader',
      'bluechip_owner',
      'app_smart_money',
      'arbitrager',
    ])
    expect(WHALE_HARVEST_TAGS).toContain('photon')
    expect(WHALE_HARVEST_TAGS).toContain('bullx')
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
