// ─────────────────────────────────────────────────────────────
// GMGN wiring tests — source-selection + historical-USD fill.
// Pure parts only: no network, no DB, no live env.
// ─────────────────────────────────────────────────────────────
import { afterEach, describe, expect, it } from 'vitest';
import { applyHistoricalUsdToSwap, resolveWalletActivitySource } from '../wallet-refresh';
import { SOL_MINT, type NormalizedSwap } from '../solana-harvest';

function swap(over: Partial<NormalizedSwap> = {}): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: 'W',
    transactionSignature: 'sig-1',
    timestamp: 1_800_000_000_000,
    inputMint: SOL_MINT,
    outputMint: 'MintA',
    inputAmount: 2,
    outputAmount: 100,
    inputUsd: null,
    outputUsd: null,
    feeNative: 0.000005,
    feeUsd: 0.001,
    feeKnown: true,
    source: 'gmgn:wallet_activity',
    completeness: 'complete',
    limitations: ['stalePrice-current-only'],
    ...over,
  };
}

afterEach(() => {
  delete process.env.WALLET_ACTIVITY_SOURCE;
});

describe('resolveWalletActivitySource — env parsing', () => {
  it('defaults to gmgn when WALLET_ACTIVITY_SOURCE is unset', () => {
    expect(resolveWalletActivitySource()).toBe('gmgn');
  });

  it('returns rpc when explicitly requested', () => {
    process.env.WALLET_ACTIVITY_SOURCE = 'rpc';
    expect(resolveWalletActivitySource()).toBe('rpc');
  });

  it('falls back to gmgn for garbage values', () => {
    process.env.WALLET_ACTIVITY_SOURCE = 'garbage';
    expect(resolveWalletActivitySource()).toBe('gmgn');
  });
});

describe('applyHistoricalUsdToSwap — fill without weakening the gate', () => {
  it('fills the SOL leg with price * inputAmount and clears the stale flag', () => {
    const s = swap({});
    const applied = applyHistoricalUsdToSwap(s, 12.5);
    expect(applied).toBe(true);
    expect(s.inputUsd).toBe(25);
    expect(s.limitations).not.toContain('stalePrice-current-only');
    expect(s.source).toBe('gmgn:wallet_activity+geckoterminal');
  });

  it('sets the output USD leg to the same trade-time value', () => {
    const s = swap({});
    applyHistoricalUsdToSwap(s, 12.5);
    expect(s.outputUsd).toBe(25);
  });

  it('keeps the stale flag when the oracle returns null', () => {
    const s = swap({});
    const applied = applyHistoricalUsdToSwap(s, null);
    expect(applied).toBe(false);
    expect(s.inputUsd).toBeNull();
    expect(s.limitations).toContain('stalePrice-current-only');
  });

  it('refuses to fill partial or non-SOL legs even with a price', () => {
    const partial = swap({ completeness: 'partial' });
    expect(applyHistoricalUsdToSwap(partial, 12.5)).toBe(false);
    expect(partial.inputUsd).toBeNull();

    const nonSol = swap({ inputMint: 'MintB', outputMint: SOL_MINT });
    expect(applyHistoricalUsdToSwap(nonSol, 12.5)).toBe(false);
    expect(nonSol.inputUsd).toBeNull();
  });
});
