import { describe, it, expect, vi } from 'vitest'
import type { WhaleBuyRow } from '@/lib/modules/derived/whale-buy-store'
import type { SheetsApi } from '@/lib/modules/derived/smart-money-sync'

function row(over: Partial<WhaleBuyRow> = {}): WhaleBuyRow {
  return {
    contract: 'MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    chain: 'solana',
    buyers: ['Wallet111', 'Wallet222'],
    buyVolumeUsd: 25_000,
    buyCount: 2,
    firstBuyAt: Date.UTC(2026, 9, 19, 10, 0, 0),
    lastBuyAt: Date.UTC(2026, 9, 19, 11, 30, 0),
    ...over,
  }
}

function stubApi(overrides: Partial<SheetsApi> = {}): SheetsApi {
  return {
    get: vi.fn(async () => []),
    append: vi.fn(async () => true),
    update: vi.fn(async () => true),
    clear: vi.fn(async () => true),
    batchUpdate: vi.fn(async () => true),
    ...overrides,
  }
}

describe('whaleBuysToSheetValues', () => {
  it('emits the fixed header first', () => {
    expect(whaleBuysToSheetValues([])).toEqual([[...WHALE_SCAN_HEADER]])
  })

  it('sorts by volume desc and formats timestamps in UTC', () => {
    const values = whaleBuysToSheetValues([
      row({ contract: 'SMALL', buyVolumeUsd: 1_000 }),
      row({ contract: 'BIG', buyVolumeUsd: 90_000 }),
    ])
    expect(values[1][0]).toBe('BIG')
    expect(values[2][0]).toBe('SMALL')
    expect(values[1][5]).toBe('2026-10-19 10:00:00')
    expect(values[1][3]).toBe('90000.00')
  })

  it('renders empty timestamps and joins buyers', () => {
    const values = whaleBuysToSheetValues([
      row({ firstBuyAt: null, lastBuyAt: null, buyers: ['A', 'B'] }),
    ])
    expect(values[1][5]).toBe('')
    expect(values[1][6]).toBe('')
    expect(values[1][2]).toBe('A, B')
  })
})

describe('syncWhaleScanSheet', () => {
  it('creates the tab, clears it, then writes header + rows', async () => {
    const api = stubApi()
    const written = await syncWhaleScanSheet([row(), row({ contract: 'B' })], api)

    expect(written).toBe(2)
    expect(api.batchUpdate).toHaveBeenCalledWith([{ addSheet: { properties: { title: WHALE_SCAN_TAB } } }])
    expect(api.clear).toHaveBeenCalled()
    expect(api.update).toHaveBeenCalledTimes(1)
    const [range, values] = vi.mocked(api.update).mock.calls[0]
    expect(range).toContain(`${WHALE_SCAN_TAB}!A1:G3`)
    expect((values as string[][]).length).toBe(3)
  })

  it('writes a header-only tab when there are no candidates (proves the sync ran)', async () => {
    const api = stubApi()
    const written = await syncWhaleScanSheet([], api)
    expect(written).toBe(0)
    const [, values] = vi.mocked(api.update).mock.calls[0]
    expect(values).toEqual([[...WHALE_SCAN_HEADER]])
  })

  it('returns 0 and does not throw when credentials are missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(syncWhaleScanSheet([row()], null)).resolves.toBe(0)
    warn.mockRestore()
  })

  it('returns 0 when the update is rejected, without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = stubApi({ update: vi.fn(async () => false) })
    await expect(syncWhaleScanSheet([row()], api)).resolves.toBe(0)
    err.mockRestore()
  })

  it('swallows a thrown API error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = stubApi({
      batchUpdate: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    await expect(syncWhaleScanSheet([row()], api)).resolves.toBe(0)
    err.mockRestore()
  })
})

import {
  whaleBuysToSheetValues,
  syncWhaleScanSheet,
  whaleWalletsToSheetValues,
  syncWhaleWalletSheet,
  WHALE_SCAN_HEADER,
  WHALE_SCAN_TAB,
  WHALE_WALLET_HEADER,
  WHALE_WALLET_TAB,
} from '@/lib/modules/derived/whale-sheet-sync'
import type { WhaleWalletRecord } from '@/lib/modules/derived/whale-wallet-registry'

const WALLET: WhaleWalletRecord = {
  address: 'Whale111',
  alias: 'Kang Rug',
  status: 'WHALE',
  winRate: 0.75,
  pnl30d: 1.23,
  labels: ['axiom', 'kol-monitor'],
  timesCaught: 5,
  firstCaughtAt: Date.UTC(2026, 9, 18, 9, 0, 0),
  lastCaughtAt: Date.UTC(2026, 9, 19, 12, 0, 0),
  tokens: ['MintA', 'MintB'],
}

describe('whaleWalletsToSheetValues', () => {
  it('emits the fixed header first', () => {
    expect(whaleWalletsToSheetValues([])).toEqual([[...WHALE_WALLET_HEADER]])
  })

  it('sorts by timesCaught desc then lastCaughtAt, formats identity', () => {
    const values = whaleWalletsToSheetValues([WALLET, { ...WALLET, address: 'Whale2', timesCaught: 1 }])
    expect(values.length).toBe(3)
    expect(values[1][0]).toBe('Whale111')
    expect(values[1].slice(0, 6)).toEqual(['Whale111', 'Kang Rug', 'WHALE', '75.0', '123.0', 'axiom,kol-monitor'])
    expect(values[1][6]).toBe('5')
    expect(values[1][8]).toBe('2026-10-19 12:00:00')
    expect(values[1][9]).toBe('MintA, MintB')
  })
})

describe('syncWhaleWalletSheet', () => {
  it('rewrites the wallet tab with header + rows', async () => {
    const api = stubApi()
    const written = await syncWhaleWalletSheet([WALLET, WALLET], api)
    expect(written).toBe(2)
    expect(api.batchUpdate).toHaveBeenCalledWith([{ addSheet: { properties: { title: WHALE_WALLET_TAB } } }])
    const [range, values] = vi.mocked(api.update).mock.calls[0]
    expect(range).toContain(`${WHALE_WALLET_TAB}!A1:J3`)
    expect((values as string[][]).length).toBe(3)
  })

  it('writes a header-only tab when the registry is empty, without throwing', async () => {
    const api = stubApi()
    await expect(syncWhaleWalletSheet([], api)).resolves.toBe(0)
    const [, values] = vi.mocked(api.update).mock.calls[0]
    expect(values).toEqual([[...WHALE_WALLET_HEADER]])
  })

  it('returns 0 and never touches the sheet when credentials are missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(syncWhaleWalletSheet([WALLET], null)).resolves.toBe(0)
    warn.mockRestore()
  })
})
