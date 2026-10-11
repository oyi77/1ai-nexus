// ─────────────────────────────────────────────────────────────
// Wallet refresh tests — candidate gating + evidence plumbing.
// Pure logic only; no RPC, no DB.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { buildBuyVolume30d } from './wallet-refresh';
import { SOL_MINT, type NormalizedSwap } from './solana-harvest';

const BASE: NormalizedSwap = {
  chain: 'solana',
  walletAddress: 'W',
  transactionSignature: 'sig',
  timestamp: 1_800_000_000_000 - 1_000_000,
  inputMint: SOL_MINT,
  outputMint: 'MintA',
  inputAmount: 1,
  outputAmount: 100,
  inputUsd: 150,
  outputUsd: null,
  feeNative: 0.000005,
  feeUsd: 0.001,
  feeKnown: true,
  source: 'synthetic',
  completeness: 'complete',
  limitations: [],
};

function sw(over: Partial<NormalizedSwap>): NormalizedSwap {
  return { ...BASE, ...over };
}

describe('buildBuyVolume30d', () => {
  it('takes only complete historical-USD buy legs inside 30d', () => {
    const r = buildBuyVolume30d([sw({})], BASE.timestamp ?? 0);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].usd).toBe(150);
  });

  it('excludes current-price (stale) legs', () => {
    const r = buildBuyVolume30d([sw({ limitations: ['stalePrice-current-only'] })], BASE.timestamp ?? 0);
    expect(r.legs).toHaveLength(0);
  });

  it('excludes partial legs and non-buy sides', () => {
    const r = buildBuyVolume30d(
      [
        sw({ completeness: 'partial' }),
        sw({ inputMint: 'MintA', outputMint: SOL_MINT, inputUsd: 100 }),
      ],
      BASE.timestamp ?? 0,
    );
    expect(r.legs).toHaveLength(0);
  });
});
