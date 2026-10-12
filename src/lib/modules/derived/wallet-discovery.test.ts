import { describe, expect, it } from 'vitest'
import type { NormalizedSwap } from './solana-harvest'
import { SOL_MINT, accumulationLabel, classifyBuy, foldWalletBuys } from './wallet-discovery'
import type { WalletBuyCandidate } from './wallet-discovery'

const W1 = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const W2 = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
const MINT = '4yMEDVPZdMZa7Kc1HQMHdgYcTowMwdWJhhAbyt49pump'

function swap(over: Partial<NormalizedSwap> = {}): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: W1,
    transactionSignature: 'sig1',
    timestamp: 1_700_000_000_000,
    inputMint: SOL_MINT,
    outputMint: MINT,
    inputAmount: 1,
    outputAmount: 1000,
    inputUsd: 2500,
    outputUsd: 2500,
    feeNative: 0.0001,
    feeUsd: 0.02,
    feeKnown: true,
    source: 'solana-rpc:mainnet-beta',
    completeness: 'complete',
    limitations: [],
    ...over,
  }
}

describe('classifyBuy — deliberate rejection reasons', () => {
  it('a complete, historically-priced SOL→token buy is accepted', () => {
    expect(classifyBuy(swap(), W1)).toEqual({ ok: true, amountUsd: 2500 })
  })
  it('a partial leg cannot prove its size → rejected', () => {
    const r = classifyBuy(swap({ completeness: 'partial' }), W1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('completeness')
  })
  it('a current-price leg is not a cost basis → rejected', () => {
    const r = classifyBuy(swap({ limitations: ['stalePrice-current-only'] }), W1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('current-price-not-historical')
  })
  it('missing historical USD → rejected, never counted as 0', () => {
    const r = classifyBuy(swap({ inputUsd: null }), W1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('missing-historical-usd')
  })
  it('a token→SOL leg is a sell, not a buy → rejected', () => {
    const r = classifyBuy(swap({ inputMint: MINT, outputMint: SOL_MINT }), W1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-sol-leg')
  })
  it('a wrapped-SOL round trip is not a token buy', () => {
    const r = classifyBuy(swap({ outputMint: SOL_MINT }), W1)
    expect(r.ok).toBe(false)
  })
  it('a non-swap (transfer) never reaches here but is rejected by reason too', () => {
    const r = classifyBuy(swap({ completeness: 'rejected', rejectReason: 'non-swap-no-pair' }), W1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('non-swap-no-pair')
  })
})

describe('foldWalletBuys — accumulation and dedup', () => {
  const NOW = 1_700_000_600_000
  const opts = { now: NOW, sinceMs: NOW - 3_600_000, minBuyUsd: 1_000 }

  it('three wallets buying one mint is ONE candidate with three buyers', () => {
    const out = foldWalletBuys(
      [
        { wallet: W1, swaps: [swap({ inputUsd: 5_000 })] },
        { wallet: W2, swaps: [swap({ walletAddress: W2, transactionSignature: 'sig2', inputUsd: 7_000 })] },
        { wallet: W1, swaps: [swap({ transactionSignature: 'sig3', inputUsd: 3_000 })] },
      ],
      opts,
    )
    expect(out).toHaveLength(1)
    expect(out[0].buyers).toEqual([W1, W2])
    expect(out[0].buyVolumeUsd).toBe(15_000)
    expect(out[0].buyCount).toBe(3)
  })

  it('a re-harvested signature does not double-count', () => {
    const out = foldWalletBuys([{ wallet: W1, swaps: [swap({ inputUsd: 5_000 }), swap({ inputUsd: 5_000 })] }], opts)
    expect(out[0].buyVolumeUsd).toBe(5_000)
    expect(out[0].buyCount).toBe(1)
  })

  it('a buy below the USD floor is not a candidate', () => {
    const out = foldWalletBuys([{ wallet: W1, swaps: [swap({ inputUsd: 400 })] }], opts)
    expect(out).toHaveLength(0)
  })

  it('buys outside the window are ignored', () => {
    const out = foldWalletBuys([{ wallet: W1, swaps: [swap({ timestamp: NOW - 7_200_000, inputUsd: 99_000 })] }], opts)
    expect(out).toHaveLength(0)
  })

  it('a sell is never a discovery trigger', () => {
    const out = foldWalletBuys(
      [{ wallet: W1, swaps: [swap({ inputMint: MINT, outputMint: SOL_MINT, inputUsd: 99_000 })] }],
      opts,
    )
    expect(out).toHaveLength(0)
  })

  it('strongest accumulation ranks first', () => {
    const out = foldWalletBuys(
      [
        { wallet: W1, swaps: [swap({ outputMint: 'AAA', transactionSignature: 'sig-aaa', inputUsd: 2_000 })] },
        { wallet: W1, swaps: [swap({ outputMint: 'BBB', transactionSignature: 'sig-bbb', inputUsd: 90_000 })] },
      ],
      opts,
    )
    expect(out.map((c) => c.contract)).toEqual(['BBB', 'AAA'])
  })

  it('evidence rows carry provider/category/timestamp, never a fabricated claim', () => {
    const out = foldWalletBuys([{ wallet: W1, swaps: [swap({ inputUsd: 5_000 })] }], opts)
    const ev = out[0].discoveryEvidence[0]
    expect(ev.provider).toBe('wallet-trace')
    expect(ev.category).toBe('WHALE_ACTIVITY')
    expect(ev.discoveredAt).toBe(1_700_000_000_000)
    expect(ev.note).toContain('5,000')
  })
})

describe('accumulationLabel', () => {
  it('labels breadth without overstating a single wallet', () => {
    const base: Omit<WalletBuyCandidate, 'buyers'> = {
      contract: 'MINT',
      chain: 'solana',
      discoveredBy: W1,
      buyVolumeUsd: 5_000,
      buyCount: 1,
      firstBuyAt: 1,
      lastBuyAt: 1,
      discoveryEvidence: [],
    }
    expect(accumulationLabel({ ...base, buyers: [W1] })).toContain('satu wallet')
    expect(accumulationLabel({ ...base, buyers: [W1, W2] })).toContain('dua wallet')
    expect(accumulationLabel({ ...base, buyers: [W1, W2, W1] })).toContain('terkoordinasi')
  })
})
