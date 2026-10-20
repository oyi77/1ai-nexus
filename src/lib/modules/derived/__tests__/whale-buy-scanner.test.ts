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
const mockDiscoverEstablishedGmgnTokens = vi.fn()
const mockListGmgnTokenHolders = vi.fn()

vi.mock('@/lib/modules/meme/gmgn', () => ({
  discoverEstablishedGmgnTokens: (...args: unknown[]) => mockDiscoverEstablishedGmgnTokens(...args),
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
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
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
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
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
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([])

    const result = await scanWhaleBuys({ tokenLimit: 5 })

    expect(result.tokensScanned).toBe(0)
    expect(result.detections).toEqual([])
    expect(result.aggregated).toEqual([])
  })

  it('returns empty detections when token has no holders', async () => {
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([])

    const result = await scanWhaleBuys({ tokenLimit: 5 })

    expect(result.tokensScanned).toBe(1)
    expect(result.detections).toEqual([])
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
  })

  it('records an error when token discovery itself throws', async () => {
    mockDiscoverEstablishedGmgnTokens.mockRejectedValue(new Error('GMGN down'))

    const result = await scanWhaleBuys({ tokenLimit: 5 })

    expect(result.tokensScanned).toBe(0)
    expect(result.detections).toEqual([])
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('token-discovery')
  })

  it('isolates wallet-activity failure — one dead wallet does not zero a token', async () => {
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
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
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
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
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
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

  it('skips already-seen tokens and rotates to fresh candidates (filterSeen)', async () => {
    const TOKEN2 = 'FreshMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'SEEN' },
      { contract: TOKEN2, chain: 'solana', symbol: 'FRESH' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [nswap({ outputMint: TOKEN2, inputUsd: 50_000 })],
      coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
      note: 'gmgn',
    })

    const result = await scanWhaleBuys({
      tokenLimit: 5,
      holderLimit: 5,
      config: { minUsd: 10_000 },
      filterSeen: async (chain, contract) => chain === 'solana' && contract === TOKEN,
    })

    // Deeper pool requested so rotation has candidates beyond the top 10.
    expect(mockDiscoverEstablishedGmgnTokens).toHaveBeenCalledWith(30)
    // Only the unseen token consumed holder/activity budget.
    expect(mockListGmgnTokenHolders).toHaveBeenCalledTimes(1)
    expect(result.tokensScanned).toBe(1)
    expect(result.aggregated[0].contract).toBe(TOKEN2)
  })

  it('falls back to top candidates when every token is seen (never an empty pass)', async () => {
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'SEEN' },
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
      config: { minUsd: 10_000 },
      filterSeen: async () => true,
    })

    expect(result.tokensScanned).toBe(1)
    expect(result.aggregated[0].contract).toBe(TOKEN)
  })
})


describe('scanWhaleBuys — recency floor (sinceMs)', () => {
  const DAY = 86_400_000

  it('drops a stale leg so an old buy cannot masquerade as fresh accumulation', async () => {
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [
        // 28 days old — the exact failure that emitted "Window: 673.8h".
        nswap({ transactionSignature: 'stale', timestamp: T0 - 28 * DAY, inputUsd: 8_000 }),
        // inside the floor.
        nswap({ transactionSignature: 'fresh', timestamp: T0, inputUsd: 50_000 }),
      ],
      coverage: { sigsSeen: 2, validEvents: 2, complete: true, gaps: [] },
      note: 'gmgn',
    })

    const result = await scanWhaleBuys({
      tokenLimit: 5,
      holderLimit: 5,
      config: { minUsd: 1_000 },
      sinceMs: T0 - 12 * 60 * 60_000,
    })

    expect(result.detections).toHaveLength(1)
    expect(result.detections[0].usdValue).toBe(50_000)
    expect(result.aggregated[0].firstBuyAt).toBe(T0)
    expect(result.aggregated[0].lastBuyAt).toBe(T0)
  })

  it('drops a leg with an unknown timestamp — it cannot prove recency', async () => {
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [nswap({ timestamp: null, inputUsd: 50_000 })],
      coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
      note: 'gmgn',
    })

    const result = await scanWhaleBuys({
      tokenLimit: 5,
      config: { minUsd: 1_000 },
      sinceMs: T0 - 60_000,
    })

    expect(result.detections).toEqual([])
    expect(result.aggregated).toEqual([])
  })

  it('keeps every leg when no floor is supplied (backward compatible)', async () => {
    mockDiscoverEstablishedGmgnTokens.mockResolvedValue([
      { contract: TOKEN, chain: 'solana', symbol: 'TEST' },
    ])
    mockListGmgnTokenHolders.mockResolvedValue([holderRow(WALLET_A)])
    mockFetchWalletActivity.mockResolvedValue({
      source: 'gmgn',
      swaps: [nswap({ transactionSignature: 'old', timestamp: T0 - 28 * DAY, inputUsd: 5_000 })],
      coverage: { sigsSeen: 1, validEvents: 1, complete: true, gaps: [] },
      note: 'gmgn',
    })

    const result = await scanWhaleBuys({ tokenLimit: 5, config: { minUsd: 1_000 } })

    expect(result.detections).toHaveLength(1)
  })
})