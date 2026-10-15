// ─────────────────────────────────────────────────────────────
// confluence producer/state tests — pure only, zero DB, zero network.
// Covers: swapToConfluenceSwap mapping (buy/complete+USD → mapped; sell →
// null; null USD → null; rejected → null), dedupe/cooldown decision (first
// allow, within window suppress, after window allow, boundary), state prune,
// alert render (mint present, footer present, under budget).
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { swapToConfluenceSwap } from '../confluence-producer';
import {
  markConfluenceSent,
  pruneConfluenceSeenState,
  renderConfluenceAlert,
  shouldSendConfluence,
  CONFLUENCE_ALERT_MAX_CHARS,
  type ConfluenceWalletRow,
} from '../confluence-state';
import type { NormalizedSwap } from '../solana-harvest';
import { SOL_MINT } from '../solana-harvest';
import type { ConfluenceSignal } from '../smart-money-confluence';

const TOKEN = 'TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WALLET = 'Wallet11111111111111111111111111111111111111';
const T0 = 1_700_000_000_000;

function nswap(over: Partial<NormalizedSwap>): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: WALLET,
    transactionSignature: 'sig',
    timestamp: T0,
    inputMint: SOL_MINT,
    outputMint: TOKEN,
    inputAmount: 10,
    outputAmount: 1000,
    inputUsd: 1_000,
    outputUsd: null,
    feeNative: null,
    feeUsd: null,
    feeKnown: false,
    source: 'gmgn',
    completeness: 'complete',
    limitations: [],
    ...over,
  };
}

describe('swapToConfluenceSwap', () => {
  it('maps a complete SOL→token buy leg with USD', () => {
    const out = swapToConfluenceSwap(nswap({}));
    expect(out).not.toBeNull();
    expect(out!.walletAddress).toBe(WALLET);
    expect(out!.inputMint).toBe(SOL_MINT);
    expect(out!.outputMint).toBe(TOKEN);
    expect(out!.inputUsd).toBe(1_000);
    expect(out!.completeness).toBe('complete');
  });

  it('returns null for a sell leg (token→SOL)', () => {
    expect(
      swapToConfluenceSwap(nswap({ inputMint: TOKEN, outputMint: SOL_MINT })),
    ).toBeNull();
  });

  it('returns null for a complete leg with null inputUsd (never invent USD)', () => {
    expect(swapToConfluenceSwap(nswap({ inputUsd: null }))).toBeNull();
  });

  it('returns null for a rejected row', () => {
    expect(
      swapToConfluenceSwap(nswap({ completeness: 'rejected', inputUsd: null })),
    ).toBeNull();
  });
});

describe('confluence seen state — dedupe + cooldown', () => {
  const sig = { tokenMint: TOKEN };
  const COOLDOWN = 6 * 60 * 60 * 1000;

  it('allows the first sighting, suppresses inside the window, allows after', () => {
    const state = markConfluenceSent({}, TOKEN, T0);
    expect(shouldSendConfluence(sig, {}, T0, COOLDOWN)).toBe(true);
    expect(shouldSendConfluence(sig, state, T0 + COOLDOWN - 1, COOLDOWN)).toBe(false);
    expect(shouldSendConfluence(sig, state, T0 + COOLDOWN, COOLDOWN)).toBe(true);
  });

  it('prunes entries older than 7d and keeps fresh ones', () => {
    const state = {
      fresh: T0,
      stale: T0 - 7 * 24 * 60 * 60 * 1000 - 1,
    };
    const pruned = pruneConfluenceSeenState(state, T0);
    expect(Object.keys(pruned).sort()).toEqual(['fresh']);
  });
});

describe('renderConfluenceAlert', () => {
  const signal: ConfluenceSignal = {
    tokenMint: TOKEN,
    windowStart: T0,
    windowEnd: T0 + 15 * 60_000,
    qualifiedBuyers: [WALLET],
    totalBuyUsd: 1_500,
    firstBuyAt: T0,
    lastBuyAt: T0 + 5 * 60_000,
  };
  const wallets: ConfluenceWalletRow[] = [
    { address: WALLET, status: 'WHALE_AND_SMART_MONEY', alias: 'Alpha Whale' },
  ];

  it('contains the mint and the alert ≠ entry footer, under budget', () => {
    const text = renderConfluenceAlert(signal, wallets);
    expect(text).toContain(TOKEN);
    expect(text).toContain('alert ≠ entry');
    expect(text).toContain('qualified wallets');
    expect(text.length).toBeLessThan(CONFLUENCE_ALERT_MAX_CHARS);
  });

  it('renders the wallet alias and status badge', () => {
    const text = renderConfluenceAlert(signal, wallets);
    expect(text).toContain('Alpha Whale');
    expect(text).toContain('WHALE_AND_SMART_MONEY');
  });
});
