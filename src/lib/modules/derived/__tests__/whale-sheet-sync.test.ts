import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WhaleBuyRow } from '@/lib/modules/derived/whale-buy-store'
import type { WhaleWalletRecord } from '@/lib/modules/derived/whale-wallet-registry'
import type { SheetsApi } from '@/lib/modules/derived/smart-money-sync'

const stateStore = new Map<string, unknown>()

vi.mock('@/lib/modules/derived/db-state-meta', () => ({
  loadStateMeta: vi.fn(async (scope: string) => stateStore.get(scope) ?? null),
  saveStateMeta: vi.fn(async (scope: string, data: unknown) => {
    stateStore.set(scope, data)
  }),
}))

import {
  whaleBuysToSheetValues,
  whaleWalletsToSheetValues,
  buildRewriteRanges,
  syncWhaleScanSheet,
  syncWhaleWalletSheet,
  WHALE_SCAN_HEADER,
  WHALE_SCAN_TAB,
  WHALE_WALLET_HEADER,
  WHALE_WALLET_TAB,
} from '@/lib/modules/derived/whale-sheet-sync'

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

function stubApi(overrides: Partial<SheetsApi> = {}): SheetsApi {
  return {
    get: vi.fn(async () => []),
    append: vi.fn(async () => true),
    update: vi.fn(async () => true),
    clear: vi.fn(async () => true),
    batchUpdate: vi.fn(async () => true),
    batchUpdateValues: vi.fn(async () => true),
    ...overrides,
  }
}

beforeEach(() => {
  stateStore.clear()
})

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

describe('whaleWalletsToSheetValues', () => {
  it('sorts by timesCaught desc then lastCaughtAt, formats identity', () => {
    const values = whaleWalletsToSheetValues([WALLET, { ...WALLET, address: 'W2', timesCaught: 1 }])
    expect(values[1][0]).toBe('Whale111')
    expect(values[1].slice(0, 6)).toEqual([
      'Whale111',
      'Kang Rug',
      'WHALE',
      '75.0',
      '123.0',
      'axiom,kol-monitor',
    ])
    expect(values[1][8]).toBe('2026-10-19 12:00:00')
  })

  it('renders unknown identity as empty cells rather than "null"', () => {
    const values = whaleWalletsToSheetValues([
      { ...WALLET, alias: null, status: null, winRate: null, pnl30d: null, labels: [] },
    ])
    expect(values[1].slice(1, 6)).toEqual(['', '', '', '', ''])
  })
})

describe('buildRewriteRanges', () => {
  it('writes only the data block when the payload grew or matched', () => {
    const values = [[...WHALE_SCAN_HEADER], ['a']]
    expect(buildRewriteRanges('T', 1, values, 2)).toHaveLength(1)
    expect(buildRewriteRanges('T', 1, values, 0)).toHaveLength(1)
  })

  it('blanks the stale tail in the same request when the payload shrank', () => {
    const values = [[...WHALE_SCAN_HEADER], ['a']]
    const ranges = buildRewriteRanges('T', 2, values, 4)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].range).toBe('T!A1:B2')
    // rows 3..4 blanked, two columns each
    expect(ranges[1].range).toBe('T!A3:B4')
    expect(ranges[1].values).toEqual([['', ''], ['', '']])
  })
})

describe('syncWhaleScanSheet', () => {
  it('rewrites the tab in ONE atomic call (no separate clear)', async () => {
    const api = stubApi()
    const res = await syncWhaleScanSheet([row(), row({ contract: 'B' })], api)

    expect(res).toEqual({ written: 2, skipped: false })
    expect(api.clear).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
    expect(api.batchUpdateValues).toHaveBeenCalledTimes(1)
    const [ranges] = vi.mocked(api.batchUpdateValues).mock.calls[0]
    expect(ranges[0].range).toBe(`${WHALE_SCAN_TAB}!A1:G3`)
    expect(ranges[0].values).toHaveLength(3)
  })

  it('skips the write entirely when the payload is unchanged', async () => {
    const api = stubApi()
    await syncWhaleScanSheet([row()], api)
    vi.mocked(api.batchUpdateValues).mockClear()

    const second = await syncWhaleScanSheet([row()], api)
    expect(second.skipped).toBe(true)
    expect(api.batchUpdateValues).not.toHaveBeenCalled()
  })

  it('writes again when the payload changes', async () => {
    const api = stubApi()
    await syncWhaleScanSheet([row()], api)
    await syncWhaleScanSheet([row({ buyVolumeUsd: 99_999 })], api)
    expect(api.batchUpdateValues).toHaveBeenCalledTimes(2)
  })

  it('writes a header-only tab when there are no candidates', async () => {
    const api = stubApi()
    const res = await syncWhaleScanSheet([], api)
    expect(res).toEqual({ written: 0, skipped: false })
    const [ranges] = vi.mocked(api.batchUpdateValues).mock.calls[0]
    expect(ranges[0].values).toEqual([[...WHALE_SCAN_HEADER]])
  })

  it('does not record a hash when the write fails, so the next pass retries', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = stubApi({ batchUpdateValues: vi.fn(async () => false) })
    expect(await syncWhaleScanSheet([row()], api)).toEqual({ written: 0, skipped: false })

    const retryApi = stubApi()
    const retry = await syncWhaleScanSheet([row()], retryApi)
    expect(retry.skipped).toBe(false)
    expect(retryApi.batchUpdateValues).toHaveBeenCalled()
    err.mockRestore()
  })

  it('returns written:0 and never throws without credentials', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(syncWhaleScanSheet([row()], null)).resolves.toEqual({
      written: 0,
      skipped: false,
    })
    warn.mockRestore()
  })
})

describe('syncWhaleWalletSheet', () => {
  it('rewrites the wallet tab with header + rows', async () => {
    const api = stubApi()
    const res = await syncWhaleWalletSheet([WALLET, { ...WALLET, address: 'W2' }], api)
    expect(res).toEqual({ written: 2, skipped: false })
    const [ranges] = vi.mocked(api.batchUpdateValues).mock.calls[0]
    expect(ranges[0].range).toBe(`${WHALE_WALLET_TAB}!A1:J3`)
  })

  it('skips an unchanged registry and rewrites when a whale is caught again', async () => {
    const api = stubApi()
    await syncWhaleWalletSheet([WALLET], api)
    const same = await syncWhaleWalletSheet([WALLET], api)
    expect(same.skipped).toBe(true)

    const changed = await syncWhaleWalletSheet([{ ...WALLET, timesCaught: 6 }], api)
    expect(changed.skipped).toBe(false)
  })

  it('writes a header-only wallet tab when the registry is empty', async () => {
    const api = stubApi()
    await expect(syncWhaleWalletSheet([], api)).resolves.toEqual({ written: 0, skipped: false })
    const [ranges] = vi.mocked(api.batchUpdateValues).mock.calls[0]
    expect(ranges[0].values).toEqual([[...WHALE_WALLET_HEADER]])
  })

  it('returns written:0 and never touches the sheet without credentials', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(syncWhaleWalletSheet([WALLET], null)).resolves.toEqual({
      written: 0,
      skipped: false,
    })
    warn.mockRestore()
  })
})
