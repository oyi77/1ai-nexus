// ─────────────────────────────────────────────────────────────
// whale-buy-scanner tests — producer isolation, zero network.
//
// Mocks discoverGmgnTokens + listGmgnTokenHolders + fetchWalletActivity
// + prisma.smartMoneyWallet.findMany to keep the suite fully offline.
// Covers: happy path (token→holders→activity→detection), per-token
// failure isolation, empty discovery, no holders, detector threshold.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SOL_MINT, type NormalizedSwap } from '../solana-harvest'
import type { GmgnHolderRow } from '@/lib/modules/meme/gmgn'

const TOKEN = 'TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const WALLET_A = 'WalletA111111111111111111111111111111111111'
const T0 = 1_700_000_000_000

// ── Mock GMGN module ─────────────────────────────────────────
const mockDiscoverGmgnTokens = vi.fn()
const mockListGmgnTokenHolders = vi.fn()

vi.mock('@/lib/modules/meme/gmgn', () => ({
  discoverGmgnTokens: (...args: unknown[]) => mockDiscoverGmgnTokens(...args),
  listGmgnTokenHolders: (...args: unknown[]) => mockListGmgnTokenHolders(...args),
}))

// ── Mock wallet-activity module ──────────────────────────────
const mockFetchWalletActivity = vi.fn()
vi.mock('@/lib/modules/derived/wallet-activity', () => ({
  fetchWalletActivity: (...args: unknown[]) => mockFetchWalletActivity(...args),
}))

// ── Mock prisma ──────────────────────────────────────────────
const mockFindMany = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    smartMoneyWallet: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}))

// Import AFTER mocks are set up.
import { scanWhaleBuys } from '../whale-buy-scanner'

function nswap(over: Partial<NormalizedSwap>): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: WALLET_A,
    transactionSignature: 'sig',
    timestamp: T0,
    inputMint: SOL_MINT,
    outputMint: TOKEN,
    inputAmount: 10,
    outputAmount: 1000,
    inputUsd: 50_000,
    outputUsd: null,
    feeNative: null,
    feeUsd: null,
    feeKnown: false,
    source: 'gmgn',
    completeness: 'complete',
    limitations: [],
    ...over,
  }
}

function holderRow(addr: string): GmgnHolderRow {
  return {
    address: addr,
    amountPercentage: 0.05,
    costCur: 0,
    usdValue: 50_000,
    unrealizedProfit: null,
    realizedProfit: null,
    suspicious: false,
    tags: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WHALE_BUYS_DB = 'off'
  mockFindMany.mockResolvedValue([])
})

describe('scanWhaleBuys', () => {
  it('detects whale buys on a token with qualifying activity', async () => {
    mockDiscoverGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [nswap({ inputUsd: 50_000 })],
      coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
      note: 'gmgn',
    })

    const result = await scanWhaleBuys({
      tokenLimit: 5,
      holderLimit: 5,
      config: { minUsd: 10_000 },
    })

    expect(result.tokensScanned).toBe(1)
    expect(result.holdersFetched).toBe(1)
    expect(result.detections).toHaveLength(1)
    expect(result.detections[0].contract).toBe(TOKEN)
    expect(result.detections[0].usdValue).toBe(50_000)
    expect(result.aggregated).toHaveLength(1)
    expect(result.aggregated[0].buyVolumeUsd).toBe(50_000)
    expect(result.errors).toHaveLength(0)
  })

  it('isolates token failure — one dead token does not zero the scan', async () => {
    mockDiscoverGmgnTokens.mockResolvedValue([
      { contract: 'DeadToken111111111111111111111111111111111', chain: 'solana', symbol: 'DEAD' },
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [nswap({ inputUsd: 25_000 })],
      coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
      note: 'gmgn',
    })

    const result = await scanWhaleBuys({ tokenLimit: 5, config: { minUsd: 10_000 } })

    expect(result.tokensScanned).toBe(2)
    expect(result.detections).toHaveLength(1)
    expect(result.detections[0].contract).toBe(TOKEN)
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty detections when discovery returns no tokens', async () => {
    mockDiscoverGmgnTokens.mockResolvedValue([])

    const result = await scanWhaleBuys({ tokenLimit: 5 })

    expect(result.tokensScanned).toBe(0)
    expect(result.detections).toEqual([])
    expect(result.aggregated).toEqual([])
  })

  it('returns empty detections when token has no holders', async () => {
    mockDiscoverGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([])

    const result = await scanWhaleBuys({ tokenLimit: 5 })

    expect(result.tokensScanned).toBe(1)
    expect(result.detections).toEqual([])
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
  })

  it('records an error when token discovery itself throws', async () => {
    mockDiscoverGmgnTokens.mockRejectedValue(new Error('GMGN down'))

    const result = await scanWhaleBuys({ tokenLimit: 5 })

    expect(result.tokensScanned).toBe(0)
    expect(result.detections).toEqual([])
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('token-discovery')
  })

  it('isolates wallet-activity failure — one dead wallet does not zero a token', async () => {
    mockDiscoverGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([
      holderRow(WALLET_A),
      holderRow('WalletB222222222222222222222222222222222222'),
    ])
    mockFetchWalletActivity
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({
        source: 'gmgn',
        swaps: [nswap({ walletAddress: 'WalletB222222222222222222222222222222222222', inputUsd: 30_000 })],
        coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
        note: 'gmgn',
      })

    const result = await scanWhaleBuys({
      tokenLimit: 5,
      holderLimit: 5,
      config: { minUsd: 10_000 },
    })

    expect(result.detections).toHaveLength(1)
    expect(result.detections[0].usdValue).toBe(30_000)
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
  })

  it('filters non-solana tokens from discovery', async () => {
    mockDiscoverGmgnTokens.mockResolvedValue([
      { contract: '0xabc', chain: 'ethereum', symbol: 'ETH' },
      { contract: TOKEN, chain: 'solana', symbol: 'SOL' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [nswap({ inputUsd: 50_000 })],
      coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
      note: 'gmgn',
    })

    const result = await scanWhaleBuys({ tokenLimit: 5, config: { minUsd: 10_000 } })

    expect(result.tokensScanned).toBe(1)
  })

  it('classifies buyers from SmartMoneyWallet DB', async () => {
    mockDiscoverGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [nswap({ inputUsd: 50_000 })],
      coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
      note: 'gmgn',
    })
    mockFindMany.mockResolvedValue([
      { status: 'WHALE', wallet: { address: WALLET_A } },
    ])

    const result = await scanWhaleBuys({ tokenLimit: 5, config: { minUsd: 10_000 } })

    expect(result.detections[0].walletClass).toBe('WHALE')
    expect(result.detections[0].isFirstSeen).toBe(false)
  })
})
