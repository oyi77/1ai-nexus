// ─────────────────────────────────────────────────────────────
// On-chain data feed tests (audit item #6) — pure parts only.
// Proves the honest tx7d lower-bound, the historical-USD rejection,
// the cluster-data default, and the Solana Transaction row mapping.
// Zero RPC, zero DB.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  countSignaturesLast7d,
  isTx7dTruncated,
  resolveClusterDataAvailable,
  swapToTransactionRow,
} from '../wallet-refresh';
import { SOL_MINT, type NormalizedSwap, type RpcSig } from '../solana-harvest';
import { classifyBuy } from '../wallet-discovery';

const NOW = 1_800_000_000_000; // epoch ms, fixed
const DAY = 24 * 60 * 60 * 1000;

function sig(blockTime: number | null, signature = 'sig'): RpcSig {
  return { signature, blockTime, err: null, slot: 1 };
}

function swap(over: Partial<NormalizedSwap>): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: 'W',
    transactionSignature: 'tx-1',
    timestamp: NOW - DAY,
    inputMint: SOL_MINT,
    outputMint: 'MintA',
    inputAmount: 1,
    outputAmount: 100,
    inputUsd: 2500,
    outputUsd: null,
    feeNative: 0.000005,
    feeUsd: 0.001,
    feeKnown: true,
    source: 'synthetic',
    completeness: 'complete',
    limitations: [],
    ...over,
  };
}

describe('countSignaturesLast7d — honest lower bound', () => {
  it('counts only signatures at/after now-7d and skips null blockTime', () => {
    const cutoff = NOW - 7 * DAY;
    const sigs = [
      sig(cutoff / 1000), // exact boundary: included
      sig((cutoff - 1) / 1000), // just outside: excluded
      sig(NOW / 1000),
      sig(null), // missing blockTime: excluded
    ];
    expect(countSignaturesLast7d(sigs, NOW)).toBe(2);
  });

  it('treats every null-blockTime signature as unproven', () => {
    expect(countSignaturesLast7d([sig(null), sig(null)], NOW)).toBe(0);
  });
});

describe('isTx7dTruncated — limitation, never a fake exact count', () => {
  const cutoff = NOW - 7 * DAY;

  it('true when the signature list hit the per-wallet cap', () => {
    expect(
      isTx7dTruncated({ truncated: true, signatures: [sig(NOW / 1000)] }, NOW),
    ).toBe(true);
  });

  it('true when the harvested window never reached 7d depth', () => {
    expect(
      isTx7dTruncated(
        { truncated: false, signatures: [sig(NOW / 1000), sig(cutoff / 1000)] },
        NOW,
      ),
    ).toBe(true);
  });

  it('false only when the full 7d window was walked without cap', () => {
    expect(
      isTx7dTruncated(
        { truncated: false, signatures: [sig(NOW / 1000), sig((cutoff - 1) / 1000)] },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('historical USD — rejection stays intact', () => {
  it('classifyBuy still rejects current-price-only legs as cost basis', () => {
    const r = classifyBuy(swap({ limitations: ['stalePrice-current-only'] }), 'W');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('current-price-not-historical');
  });

  it('classifyBuy rejects the explicit historical-usd-unavailable flag', () => {
    const r = classifyBuy(swap({ limitations: ['historical-usd-unavailable'] }), 'W');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('current-price-not-historical');
  });

  it('classifyBuy rejects missing USD instead of counting it as zero', () => {
    const r = classifyBuy(swap({ inputUsd: null }), 'W');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-historical-usd');
  });
});

describe('clusterDataAvailable — default false, operator opt-in', () => {
  const ORIGINAL = process.env.CLUSTER_DATA_AVAILABLE;

  beforeEach(() => {
    delete process.env.CLUSTER_DATA_AVAILABLE;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CLUSTER_DATA_AVAILABLE;
    else process.env.CLUSTER_DATA_AVAILABLE = ORIGINAL;
  });

  it('defaults to false so the classifier records the limitation', () => {
    expect(resolveClusterDataAvailable()).toBe(false);
  });

  it('is true only when the operator explicitly opts in', () => {
    process.env.CLUSTER_DATA_AVAILABLE = 'true';
    expect(resolveClusterDataAvailable()).toBe(true);
  });
});

describe('swapToTransactionRow — verified Solana buy mapping', () => {
  it('maps a complete historically-priced SOL→token buy', () => {
    const row = swapToTransactionRow(swap({ transactionSignature: 'abc', inputUsd: 123.4 }), 'wallet-1');
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      walletId: 'wallet-1',
      chain: 'solana',
      txHash: 'abc',
      value: 123.4,
      amountUsd: 123.4,
      tokenSymbol: '', // unknown — never fabricated
      tokenAddress: 'MintA',
    });
    expect(row!.timestamp).toEqual(new Date(NOW - DAY));
  });

  it('returns null for partial, missing-USD, current-price, or sell legs', () => {
    expect(swapToTransactionRow(swap({ completeness: 'partial' }))).toBeNull();
    expect(swapToTransactionRow(swap({ inputUsd: null }))).toBeNull();
    expect(swapToTransactionRow(swap({ limitations: ['stalePrice-current-only'] }))).toBeNull();
    expect(swapToTransactionRow(swap({ inputMint: 'MintA', outputMint: SOL_MINT }))).toBeNull();
    expect(swapToTransactionRow(swap({ outputMint: SOL_MINT }))).toBeNull();
    expect(swapToTransactionRow(swap({ timestamp: null }))).toBeNull();
  });
});
