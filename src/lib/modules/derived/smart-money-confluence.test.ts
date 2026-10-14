// ─────────────────────────────────────────────────────────────
// smart-money-confluence tests — fixture-backed, zero DB, zero network.
// Covers: window semantics (inclusive boundary, disjoint windows),
// minBuyUsd dust filter, null-USD skip (never invent USD), incomplete
// swap skip, sell-leg exclusion, qualified-only USD sum, overlap union,
// output sorting, empty qualified set, stats accuracy.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  detectConfluence,
  CONFLUENCE_DEFAULTS,
  type ConfluenceSwap,
} from './smart-money-confluence';

const W1 = 'Wallet11111111111111111111111111111111111111';
const W2 = 'Wallet2222222222222222222222222222222222222';
const W3 = 'Wallet3333333333333333333333333333333333333';
const WQ = 'WalletQualifiedNotBuying0000000000000000000';
const TOKEN = 'TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'OtherMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const QUALIFIED = new Set([W1, W2, W3, WQ]);
const T0 = 1_700_000_000_000;

function buy(over: Partial<ConfluenceSwap>): ConfluenceSwap {
  return {
    walletAddress: W1,
    timestamp: T0,
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: TOKEN,
    inputUsd: 1_000,
    completeness: 'complete',
    ...over,
  };
}

function run(swaps: ConfluenceSwap[], qualified = QUALIFIED) {
  return detectConfluence(swaps, qualified);
}

describe('smart-money confluence', () => {
  it('emits one signal for 2 qualified buyers inside the window', () => {
    const r = run([
      buy({ walletAddress: W1, timestamp: T0, inputUsd: 600 }),
      buy({ walletAddress: W2, timestamp: T0 + 5 * 60_000, inputUsd: 900 }),
    ]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].tokenMint).toBe(TOKEN);
    expect(r.signals[0].qualifiedBuyers.sort()).toEqual([W1, W2].sort());
    expect(r.signals[0].totalBuyUsd).toBe(1_500);
  });

  it('emits nothing when the two buys sit in disjoint windows', () => {
    const r = run([
      buy({ walletAddress: W1, timestamp: T0, inputUsd: 600 }),
      buy({ walletAddress: W2, timestamp: T0 + CONFLUENCE_DEFAULTS.windowMs + 60_000, inputUsd: 900 }),
    ]);
    expect(r.signals).toHaveLength(0);
  });

  it('treats the window boundary as INCLUSIVE (span == windowMs counts)', () => {
    const r = run([
      buy({ walletAddress: W1, timestamp: T0, inputUsd: 600 }),
      buy({ walletAddress: W2, timestamp: T0 + CONFLUENCE_DEFAULTS.windowMs, inputUsd: 900 }),
    ]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].windowStart).toBe(T0);
    expect(r.signals[0].windowEnd).toBe(T0 + CONFLUENCE_DEFAULTS.windowMs);
  });

  it('applies minBuyUsd dust filter ($400 ignored, $500 counted)', () => {
    const r = run([
      buy({ walletAddress: W1, inputUsd: 400, timestamp: T0 }),
      buy({ walletAddress: W2, inputUsd: 500, timestamp: T0 + 1_000 }),
      buy({ walletAddress: W3, inputUsd: 500, timestamp: T0 + 2_000 }),
      buy({ walletAddress: WQ, inputUsd: 399.99, timestamp: T0 + 3_000 }),
    ]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].qualifiedBuyers.sort()).toEqual([W2, W3].sort());
    expect(r.signals[0].totalBuyUsd).toBe(1_000);
  });

  it('skips legs with null inputUsd without crashing or inventing USD', () => {
    const r = run([
      buy({ walletAddress: W1, inputUsd: null, timestamp: T0 }),
      buy({ walletAddress: W2, inputUsd: 750, timestamp: T0 + 1_000 }),
      buy({ walletAddress: W3, inputUsd: 800, timestamp: T0 + 2_000 }),
    ]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].qualifiedBuyers.sort()).toEqual([W2, W3].sort());
    expect(r.signals[0].totalBuyUsd).toBe(1_550);
  });

  it('skips incomplete (partial) swaps', () => {
    const r = run([
      buy({ walletAddress: W1, completeness: 'partial', inputUsd: 600 }),
      buy({ walletAddress: W2, inputUsd: 700, timestamp: T0 + 1_000 }),
      buy({ walletAddress: W3, inputUsd: 800, timestamp: T0 + 2_000 }),
    ]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].qualifiedBuyers.sort()).toEqual([W2, W3].sort());
    expect(r.signals[0].totalBuyUsd).toBe(1_500);
  });

  it('never counts sell legs (outputMint === SOL_MINT)', () => {
    const r = run([
      buy({ walletAddress: W1, outputMint: 'So11111111111111111111111111111111111111112', inputMint: TOKEN, inputUsd: 5_000 }),
      buy({ walletAddress: W2, inputUsd: 600, timestamp: T0 + 1_000 }),
      buy({ walletAddress: W3, inputUsd: 700, timestamp: T0 + 2_000 }),
    ]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].qualifiedBuyers.sort()).toEqual([W2, W3].sort());
  });

  it('excludes non-qualified wallets from buyers AND from totalBuyUsd', () => {
    const r = run([
      buy({ walletAddress: 'NonQualifiedWallet000000000000000000000000', inputUsd: 50_000, timestamp: T0 }),
      buy({ walletAddress: W1, inputUsd: 600, timestamp: T0 + 1_000 }),
      buy({ walletAddress: W2, inputUsd: 700, timestamp: T0 + 2_000 }),
      buy({ walletAddress: W3, inputUsd: 800, timestamp: T0 + 3_000 }),
    ]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].qualifiedBuyers.sort()).toEqual([W1, W2, W3].sort());
    expect(r.signals[0].totalBuyUsd).toBe(600 + 700 + 800); // 50k excluded
  });

  it('merges overlapping qualifying windows into ONE signal (union), not two', () => {
    const r = run([
      buy({ walletAddress: W1, inputUsd: 600, timestamp: T0 }),
      buy({ walletAddress: W2, inputUsd: 700, timestamp: T0 + 10 * 60_000 }),
      buy({ walletAddress: W3, inputUsd: 800, timestamp: T0 + 14 * 60_000 }),
    ]);
    expect(r.signals).toHaveLength(1);
    const s = r.signals[0];
    expect(s.qualifiedBuyers.sort()).toEqual([W1, W2, W3].sort());
    expect(s.totalBuyUsd).toBe(2_100);
    expect(s.windowStart).toBe(T0);
    expect(s.windowEnd).toBe(T0 + 14 * 60_000);
  });


  it('sorts signals: buyer count desc, then totalBuyUsd desc', () => {
    const r = run([
      // token A: 2 buyers, $650
      buy({ outputMint: TOKEN, walletAddress: W1, inputUsd: 600, timestamp: T0 }),
      buy({ outputMint: TOKEN, walletAddress: W2, inputUsd: 650, timestamp: T0 + 1_000 }),
      // token B: 3 buyers, $1_800
      buy({ outputMint: OTHER, walletAddress: W1, inputUsd: 500, timestamp: T0 }),
      buy({ outputMint: OTHER, walletAddress: W2, inputUsd: 600, timestamp: T0 + 1_000 }),
      buy({ outputMint: OTHER, walletAddress: W3, inputUsd: 700, timestamp: T0 + 2_000 }),
      // token C: 2 buyers, $1_900 (same buyer count as A, larger USD → first)
      buy({ outputMint: 'ThirdMintCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', walletAddress: W2, inputUsd: 900, timestamp: T0 }),
      buy({ outputMint: 'ThirdMintCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', walletAddress: W3, inputUsd: 1_000, timestamp: T0 + 1_000 }),
    ]);
    expect(r.signals.map((s) => s.tokenMint)).toEqual([OTHER, 'ThirdMintCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', TOKEN]);
  });

  it('emits zero signals when the qualified set is empty', () => {
    const r = run(
      [
        buy({ walletAddress: W1, inputUsd: 5_000 }),
        buy({ walletAddress: W2, inputUsd: 9_000, timestamp: T0 + 1_000 }),
      ],
      new Set<string>(),
    );
    expect(r.signals).toHaveLength(0);
    expect(r.stats.buyLegsCounted).toBe(2);
  });

  it('reports accurate stats (swapsSeen, buyLegsCounted, tokensScanned)', () => {
    const r = run([
      buy({ inputUsd: 600, timestamp: T0 }), // counted
      buy({ inputUsd: 100, timestamp: T0 + 1_000 }), // dust → not counted
      buy({ inputUsd: null, timestamp: T0 + 2_000 }), // null USD → not counted
      buy({ completeness: 'partial', inputUsd: 600, timestamp: T0 + 3_000 }), // incomplete → not counted
      buy({ inputMint: TOKEN, outputMint: 'So11111111111111111111111111111111111111112', inputUsd: 600, timestamp: T0 + 4_000 }), // sell leg → not counted
      buy({ outputMint: OTHER, inputUsd: 600, timestamp: T0 + 5_000 }), // counted, other token
      buy({ timestamp: null, inputUsd: 600 }), // no timestamp → not counted
    ]);
    expect(r.stats.swapsSeen).toBe(7);
    expect(r.stats.buyLegsCounted).toBe(2);
    expect(r.stats.tokensScanned).toBe(2);
  });
});
