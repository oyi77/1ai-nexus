// ─────────────────────────────────────────────────────────────
// accumulation-markets tests — DB-first market metadata with the
// DexScreener fallback. Zero network: fetch is stubbed, prisma is
// mocked so both layers are asserted deterministically.
//
// The regression these lock in: a Token row whose symbol is the
// address prefix and whose marketCap is 0 is a PLACEHOLDER, so it
// must not (a) name the alert `$A1B2C3` nor (b) leave the market-cap
// gate seeing null/0 and admitting a multi-million-dollar token.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockTokenFindMany = vi.fn()
const mockLaunchFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: (...a: unknown[]) => mockTokenFindMany(...a) },
    launchToken: { findMany: (...a: unknown[]) => mockLaunchFindMany(...a) },
  },
}))

import { loadMarkets } from '../accumulation-markets'
import {
  isPlaceholderRow,
  mergeWithDex,
  type MarketRow,
  type TokenMeta,
} from '../dex-token-meta'

const MINT = 'Hg5Ja55T5wESq4vyFoiVCMeHXtGyVA69X2UHq8hgpump'
const NOW = 1_792_400_000_000

function dexRow(address: string, over: Record<string, unknown> = {}) {
  return {
    chainId: 'solana',
    baseToken: { address, symbol: 'baton' },
    marketCap: 7_498_572,
    liquidity: { usd: 522_706.49 },
    pairCreatedAt: NOW - 86_400_000,
    volume: { h24: 1_200_000 },
    ...over,
  }
}

function row(over: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol: null,
    marketCapUsd: null,
    liquidityUsd: null,
    pairCreatedAtMs: null,
    volume24hUsd: null,
    ...over,
  }
}

function meta(over: Partial<TokenMeta> = {}): TokenMeta {
  return {
    symbol: 'DEXSYM',
    marketCapUsd: 999,
    liquidityUsd: 50,
    pairCreatedAtMs: null,
    volume24hUsd: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTokenFindMany.mockResolvedValue([])
  mockLaunchFindMany.mockResolvedValue([])
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isPlaceholderRow', () => {
  it('treats the address-prefix symbol written by token-holdings as a placeholder', () => {
    expect(isPlaceholderRow(MINT, row({ symbol: 'HG5JA5', marketCapUsd: 0 }))).toBe(true)
  })

  it('treats a zero market cap as a placeholder even with a real symbol', () => {
    expect(isPlaceholderRow(MINT, row({ symbol: 'BATON', marketCapUsd: 0, liquidityUsd: 1 }))).toBe(true)
  })

  it('keeps a real symbol with a positive market cap', () => {
    expect(isPlaceholderRow(MINT, row({ symbol: 'BATON', marketCapUsd: 500_000, liquidityUsd: 1 }))).toBe(false)
  })
})

describe('mergeWithDex', () => {
  it('keeps real DB values and fills only gaps', () => {
    const merged = mergeWithDex(
      MINT,
      row({ symbol: 'REAL', marketCapUsd: 123 }),
      meta({ symbol: 'DEXSYM', marketCapUsd: 999, liquidityUsd: 50, volume24hUsd: 7 }),
    )
    expect(merged).toEqual({
      symbol: 'REAL',
      marketCapUsd: 123,
      liquidityUsd: 50,
      pairCreatedAtMs: null,
      volume24hUsd: 7,
    })
  })

  it('replaces a placeholder symbol and zero market cap with API truth', () => {
    const merged = mergeWithDex(
      MINT,
      row({ symbol: 'HG5JA5', marketCapUsd: 0 }),
      meta({ symbol: 'baton', marketCapUsd: 7_498_572, liquidityUsd: 522_706.49 }),
    )
    expect(merged).toEqual({
      symbol: 'baton',
      marketCapUsd: 7_498_572,
      liquidityUsd: 522_706.49,
      pairCreatedAtMs: null,
      volume24hUsd: null,
    })
  })

  it('returns the DB row untouched when the API has nothing', () => {
    const db = row({ symbol: 'HG5JA5', marketCapUsd: 0 })
    expect(mergeWithDex(MINT, db, undefined)).toEqual(db)
  })
})

describe('loadMarkets', () => {
  it('fills a placeholder Token row from DexScreener, including pair age and 24h volume', async () => {
    mockTokenFindMany.mockResolvedValue([
      { address: MINT, chain: 'solana', symbol: 'HG5JA5', marketCap: 0 },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify([dexRow(MINT)]), { status: 200 }))),
    )

    const map = await loadMarkets([{ contract: MINT }])

    expect(map.get(MINT)).toEqual({
      symbol: 'baton',
      marketCapUsd: 7_498_572,
      liquidityUsd: 522_706.49,
      pairCreatedAtMs: NOW - 86_400_000,
      volume24hUsd: 1_200_000,
    })
  })

  it('still consults the API for a truthful DB row, because pair age/volume exist only there', async () => {
    mockTokenFindMany.mockResolvedValue([
      { address: MINT, chain: 'solana', symbol: 'BATON', marketCap: 90_000 },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify([dexRow(MINT)]), { status: 200 }))),
    )

    const map = await loadMarkets([{ contract: MINT }])

    // DB truth wins for symbol/MC; API supplies the fields the DB lacks.
    expect(map.get(MINT)?.symbol).toBe('BATON')
    expect(map.get(MINT)?.marketCapUsd).toBe(90_000)
    expect(map.get(MINT)?.volume24hUsd).toBe(1_200_000)
    expect(map.get(MINT)?.pairCreatedAtMs).toBe(NOW - 86_400_000)
  })

  it('keeps the row when the API knows nothing (unverified, never zeroed)', async () => {
    mockTokenFindMany.mockResolvedValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))),
    )

    const map = await loadMarkets([{ contract: MINT }])

    expect(map.has(MINT)).toBe(false)
  })

  it('survives a DB failure and a network failure without throwing', async () => {
    mockTokenFindMany.mockRejectedValue(new Error('db down'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const map = await loadMarkets([{ contract: MINT }])
    expect(map.size).toBe(0)
  })
})
