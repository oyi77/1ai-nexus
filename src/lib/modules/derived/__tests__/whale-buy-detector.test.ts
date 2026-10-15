// ─────────────────────────────────────────────────────────────
// whale-buy-detector tests — pure only, zero DB, zero network.
// Covers: whale buy detection (BUY legs >= minUsd → detection; below
// threshold → none), sell legs ignored, null USD skipped, rejected
// rows skipped, wrong-token outputMint skipped, per-wallet dedup
// (largest wins), classification scoring (classified vs FIRST_SEEN),
// isCurrentHolder from holder set, aggregation, sort order.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  detectWhaleBuys,
  aggregateWhaleBuyDetections,
  WHALE_BUY_DEFAULTS,
  type WhaleBuyDetection,
} from '../whale-buy-detector'
import { SOL_MINT, type NormalizedSwap } from '../solana-harvest'
import type { GmgnHolderRow } from '@/lib/modules/meme/gmgn'
import type { WalletStatus } from '../wallet-intel'

const TOKEN = 'TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const OTHER_TOKEN = 'OtherTokenMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const WALLET_A = 'WalletA111111111111111111111111111111111111'
const WALLET_B = 'WalletB222222222222222222222222222222222222'
const T0 = 1_700_000_000_000
const CHAIN = 'solana'

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

function holder(over: Partial<GmgnHolderRow> = {}): GmgnHolderRow {
  return {
    address: WALLET_A,
    amountPercentage: 0.05,
    costCur: 0,
    usdValue: 50_000,
    unrealizedProfit: null,
    realizedProfit: null,
    suspicious: false,
    tags: [],
    ...over,
  }
}

const NO_CLASSIFIED = new Map<string, WalletStatus>()

const detectInput = (over: {
  swaps?: NormalizedSwap[]
  holders?: GmgnHolderRow[]
  classifiedWallets?: Map<string, WalletStatus>
  config?: { minUsd: number }
} = {}) => ({
  contract: TOKEN,
  chain: CHAIN,
  swaps: over.swaps ?? [nswap({})],
  holders: over.holders ?? [holder()],
  classifiedWallets: over.classifiedWallets ?? NO_CLASSIFIED,
  config: over.config,
})

describe('detectWhaleBuys', () => {
  it('detects a BUY leg above the threshold', () => {
    const out = detectWhaleBuys(detectInput())
    expect(out).toHaveLength(1)
    expect(out[0].contract).toBe(TOKEN)
    expect(out[0].wallet).toBe(WALLET_A)
    expect(out[0].usdValue).toBe(50_000)
    expect(out[0].boughtAt).toBe(T0)
  })

  it('ignores BUY legs below the whale threshold', () => {
    const out = detectWhaleBuys(
      detectInput({ swaps: [nswap({ inputUsd: 500 })] }),
    )
    expect(out).toEqual([])
  })

  it('ignores sell legs (token → SOL)', () => {
    const out = detectWhaleBuys(
      detectInput({
        swaps: [nswap({ inputMint: TOKEN, outputMint: SOL_MINT, inputUsd: 100_000 })],
      }),
    )
    expect(out).toEqual([])
  })

  it('ignores non-SOL inputMint legs', () => {
    const out = detectWhaleBuys(
      detectInput({
        swaps: [nswap({ inputMint: 'USDCmint1111111111111111111111111111111' })],
      }),
    )
    expect(out).toEqual([])
  })

  it('skips swaps with null USD (never invent USD)', () => {
    const out = detectWhaleBuys(
      detectInput({ swaps: [nswap({ inputUsd: null })] }),
    )
    expect(out).toEqual([])
  })

  it('skips rejected and partial swaps', () => {
    const rejected = nswap({ completeness: 'rejected' as const })
    const partial = nswap({ completeness: 'partial' as const })
    const out = detectWhaleBuys(detectInput({ swaps: [rejected, partial] }))
    expect(out).toEqual([])
  })

  it('skips swaps for a different token', () => {
    const out = detectWhaleBuys(
      detectInput({ swaps: [nswap({ outputMint: OTHER_TOKEN })] }),
    )
    expect(out).toEqual([])
  })

  it('holders without a BUY leg produce NO detection', () => {
    // Holder exists, but no swap rows at all.
    const out = detectWhaleBuys(
      detectInput({ swaps: [], holders: [holder()] }),
    )
    expect(out).toEqual([])
  })

  it('deduplicates by wallet, keeping the largest buy', () => {
    const out = detectWhaleBuys(
      detectInput({
        swaps: [
          nswap({ inputUsd: 15_000, transactionSignature: 'sig1' }),
          nswap({ inputUsd: 50_000, transactionSignature: 'sig2' }),
          nswap({ inputUsd: 30_000, transactionSignature: 'sig3' }),
        ],
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].usdValue).toBe(50_000)
  })

  it('keeps separate detections per wallet, sorted USD descending', () => {
    const out = detectWhaleBuys(
      detectInput({
        swaps: [
          nswap({ walletAddress: WALLET_A, inputUsd: 15_000 }),
          nswap({ walletAddress: WALLET_B, inputUsd: 80_000 }),
        ],
        holders: [holder({ address: WALLET_A }), holder({ address: WALLET_B })],
      }),
    )
    expect(out).toHaveLength(2)
    expect(out[0].wallet).toBe(WALLET_B)
    expect(out[1].wallet).toBe(WALLET_A)
  })

  it('scores unclassified wallets as FIRST_SEEN', () => {
    const out = detectWhaleBuys(detectInput())
    expect(out[0].walletClass).toBe('FIRST_SEEN')
    expect(out[0].isFirstSeen).toBe(true)
  })

  it('scores classified wallets with their real status', () => {
    const classifiedWallets = new Map<string, WalletStatus>([
      [WALLET_A, 'QUALIFIED_SMART_MONEY'],
    ])
    const out = detectWhaleBuys(detectInput({ classifiedWallets }))
    expect(out[0].walletClass).toBe('QUALIFIED_SMART_MONEY')
    expect(out[0].isFirstSeen).toBe(false)
  })

  it('marks isCurrentHolder when the buyer is a current top holder', () => {
    const out = detectWhaleBuys(detectInput())
    expect(out[0].isCurrentHolder).toBe(true)
  })

  it('marks isCurrentHolder=false when the buyer is NOT a holder', () => {
    const out = detectWhaleBuys(
      detectInput({ holders: [holder({ address: WALLET_B })] }),
    )
    expect(out[0].isCurrentHolder).toBe(false)
  })

  it('honours a custom minUsd threshold', () => {
    const out = detectWhaleBuys(
      detectInput({
        swaps: [nswap({ inputUsd: 50_000 })],
        config: { minUsd: 100_000 },
      }),
    )
    expect(out).toEqual([])
  })

  it('passes through null timestamps without fabricating', () => {
    const out = detectWhaleBuys(
      detectInput({ swaps: [nswap({ timestamp: null })] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].boughtAt).toBeNull()
  })

  it('default threshold is $10k', () => {
    expect(WHALE_BUY_DEFAULTS.minUsd).toBe(10_000)
  })
})

describe('aggregateWhaleBuyDetections', () => {
  it('aggregates detections into per-contract rows', () => {
    const det = (wallet: string, usd: number, ts: number | null): WhaleBuyDetection => ({
      contract: TOKEN,
      chain: CHAIN,
      wallet,
      usdValue: usd,
      boughtAt: ts,
      walletClass: 'FIRST_SEEN',
      isFirstSeen: true,
      isCurrentHolder: false,
    })
    const rows = aggregateWhaleBuyDetections([
      det(WALLET_A, 50_000, T0),
      det(WALLET_B, 80_000, T0 + 1000),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].buyers).toEqual([WALLET_A, WALLET_B])
    expect(rows[0].buyVolumeUsd).toBe(130_000)
    expect(rows[0].buyCount).toBe(2)
    expect(rows[0].firstBuyAt).toBe(T0)
    expect(rows[0].lastBuyAt).toBe(T0 + 1000)
  })

  it('keeps separate rows per contract', () => {
    const det = (contract: string): WhaleBuyDetection => ({
      contract,
      chain: CHAIN,
      wallet: WALLET_A,
      usdValue: 50_000,
      boughtAt: T0,
      walletClass: 'FIRST_SEEN',
      isFirstSeen: true,
      isCurrentHolder: false,
    })
    const rows = aggregateWhaleBuyDetections([det(TOKEN), det(OTHER_TOKEN)])
    expect(rows).toHaveLength(2)
  })

  it('returns [] for no detections', () => {
    expect(aggregateWhaleBuyDetections([])).toEqual([])
  })
})
