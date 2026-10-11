// ─────────────────────────────────────────────────────────────
// FIFO episode builder — SYNTHETIC_TEST_FIXTURE cases.
// Hand-authored inputs; NO mainnet data. Proves contract only:
// chain+wallet+token keying, FIFO cost basis, partial sells,
// open-frac, fee-once-per-sig, missing-USD never zero, orphan sells,
// deterministic ordering, no wallet/chain bleed.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { buildEpisodes } from './wallet-episodes';
import { SOL_MINT, type NormalizedSwap } from './solana-harvest';

const W = 'WalletSynthA';
const W2 = 'WalletSynthB';
const T1 = 'MintSynthOne';
const T2 = 'MintSynthTwo';

function sw(over: Partial<NormalizedSwap> = {}): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: W,
    transactionSignature: 'sig',
    timestamp: 1_700_000_000,
    inputMint: SOL_MINT,
    outputMint: T1,
    inputAmount: 100,
    outputAmount: 100,
    inputUsd: 100,
    outputUsd: null,
    feeNative: 0.000005,
    feeUsd: 0.001,
    feeKnown: true,
    source: 'synthetic-fixture',
    completeness: 'complete',
    limitations: [],
    ...over,
  };
}

describe('SYNTHETIC_TEST_FIXTURE — FIFO lot matching', () => {
  it('closes oldest lot first (FIFO) and blends matched cost', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 's1', timestamp: 100, inputUsd: 100, outputAmount: 100 }),
      sw({ transactionSignature: 's2', timestamp: 200, inputUsd: 150, outputAmount: 100 }),
      sw({
        transactionSignature: 's3', timestamp: 300,
        inputMint: T1, outputMint: SOL_MINT,
        inputAmount: 150, outputAmount: 300, inputUsd: 300, outputUsd: 300,
      }),
    ]);
    const e = r.episodes[0];
    // FIFO: lot1 unit 1.00 x100, lot2 unit 1.50 x50 => matchedCost 175
    // plus the pro-rated SOL->token buy fee on the new lot (0.0015/100)
    expect(e.buyCostUsd).toBeCloseTo(175.0015, 4);
    expect(e.closedQty).toBeCloseTo(150, 6);
  });

  it('keeps remaining qty after partial sell', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 's1', timestamp: 100, inputUsd: 100, outputAmount: 100 }),
      sw({
        transactionSignature: 's2', timestamp: 200,
        inputMint: T1, outputMint: SOL_MINT,
        inputAmount: 40, outputAmount: 80, inputUsd: 80, outputUsd: 80,
      }),
    ]);
    expect(r.episodes[0].closedQty).toBeCloseTo(40, 6);
    expect(r.openPositions[0].remainingQty).toBeCloseTo(60, 6);
  });

  it('computes openFrac as remaining over total bought', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 's1', timestamp: 100, inputUsd: 100, outputAmount: 100 }),
      sw({
        transactionSignature: 's2', timestamp: 200,
        inputMint: T1, outputMint: SOL_MINT,
        inputAmount: 25, outputAmount: 50, inputUsd: 50, outputUsd: 50,
      }),
    ]);
    expect(r.episodes[0].openFrac).toBeCloseTo(0.75, 6);
  });

  it('busy-buy keeps openFrac 1 with zero closed qty', () => {
    const r = buildEpisodes([sw({ transactionSignature: 's1', timestamp: 100 })]);
    expect(r.episodes[0].openFrac).toBe(1);
    expect(r.episodes[0].closedQty).toBe(0);
  });
});

describe('SYNTHETIC_TEST_FIXTURE — keying and isolation', () => {
  it('separates two mints for the same wallet', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 'a', timestamp: 100, outputMint: T1 }),
      sw({ transactionSignature: 'b', timestamp: 200, outputMint: T2 }),
    ]);
    const mints = r.episodes.map((e) => e.tokenMint).sort();
    expect(mints).toEqual([T1, T2]);
  });

  it('separates two wallets for the same mint', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 'a', timestamp: 100, walletAddress: W }),
      sw({ transactionSignature: 'b', timestamp: 200, walletAddress: W2 }),
    ]);
    const wallets = r.episodes.map((e) => e.walletAddress).sort();
    expect(wallets).toEqual([W, W2].sort());
  });

  it('never mixes wallets across the same mint', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 'a', timestamp: 100, walletAddress: W, inputUsd: 100 }),
      sw({ transactionSignature: 'b', timestamp: 200, walletAddress: W2, inputUsd: 100 }),
      sw({
        transactionSignature: 'c', timestamp: 300, walletAddress: W,
        inputMint: T1, outputMint: SOL_MINT,
        inputAmount: 100, outputAmount: 200, inputUsd: null, outputUsd: 200,
      }),
    ]);
    const a = r.episodes.find((e) => e.walletAddress === W);
    const b = r.episodes.find((e) => e.walletAddress === W2);
    expect(a?.closedQty).toBeCloseTo(100, 6);
    expect(b?.closedQty).toBe(0);
  });
});

describe('SYNTHETIC_TEST_FIXTURE — fees, USD, rejects', () => {
  it('attributes fee once per signature, not per leg', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 's1', timestamp: 100, inputUsd: 100, feeUsd: 0.5 }),
    ]);
    expect(r.episodes[0].feeUsdAttributed).toBeCloseTo(0.5, 6);
  });

  it('never treats missing USD as zero', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 's1', timestamp: 100, inputUsd: null }),
    ]);
    expect(r.stats.missingUsdBuySkipped).toBe(1);
    expect(r.episodes).toHaveLength(0);
    expect(r.limitations.some((l) => l.includes('missing-usd'))).toBe(true);
  });

  it('ignores orphan sells without cost basis', () => {
    const r = buildEpisodes([
      sw({
        transactionSignature: 's1', timestamp: 100,
        inputMint: T1, outputMint: SOL_MINT,
        inputAmount: 50, outputAmount: 100, inputUsd: null, outputUsd: 100,
      }),
    ]);
    expect(r.stats.orphanSells).toBe(1);
    expect(r.episodes).toHaveLength(0);
  });

  it('orders deterministic by timestamp then signature', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 'zz', timestamp: 100, inputUsd: 100 }),
      sw({ transactionSignature: 'aa', timestamp: 100, inputUsd: 200 }),
    ]);
    expect(r.episodes[0].entrySig).toBe('aa');
  });

  it('marks partial when fees unknown and drops duplicate events', () => {
    const r = buildEpisodes([
      sw({ transactionSignature: 's1', timestamp: 100, feeKnown: false }),
      sw({ transactionSignature: 's1', timestamp: 100, feeKnown: false }),
    ]);
    expect(r.stats.dupSkipped).toBe(1);
    expect(r.episodes[0].feeKnown).toBe(false);
    expect(r.episodes[0].completeness).toBe('partial');
  });
});
