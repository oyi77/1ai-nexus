// ─────────────────────────────────────────────────────────────
// REAL_MAINNET_FIXTURE regression — Jupiter router SOL->USDC swap.
// Public on-chain data only, captured read-only. Proves the parser
// handles a real transaction shape, not just synthetic shapes.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSolanaTransaction, validateSwap, SOL_MINT } from './solana-harvest';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'jup-sol-usdc-swap.json'), 'utf8'),
) as {
  signature: string;
  wallet: string;
  blockTime: number;
  fee: number;
  payerIndex: number;
  preBalancePayer: number;
  postBalancePayer: number;
  preTokenBalances: Array<{ mint: string; owner: string; uiAmount: number | null }>;
  postTokenBalances: Array<{ mint: string; owner: string; uiAmount: number | null }>;
};

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Rebuild the minimal ParsedTxLike shape the parser consumes. */
type ParsedTxLike = Parameters<typeof parseSolanaTransaction>[2];

function asParsedTx(): ParsedTxLike {
  const owners = [...new Set([
    ...fixture.preTokenBalances.map((b) => b.owner),
    ...fixture.postTokenBalances.map((b) => b.owner),
  ])];
  const keyIndex = new Map<string, number>();
  fixture.preTokenBalances.forEach((b, i) => keyIndex.set(b.owner + '|' + b.mint + '|pre', i));
  fixture.postTokenBalances.forEach((b, i) => keyIndex.set(b.owner + '|' + b.mint + '|post', i));
  // accountIndex must point into accountKeys where the wallet sits.
  // Parser reads balances by accountIndex; map owner -> index in a synthetic key list.
  owners.forEach((o, i) => { if (!keyIndex.has('idx|' + o)) keyIndex.set('idx|' + o, i + 1); });
  const accountKeys = [fixture.wallet, ...owners.filter((o) => o !== fixture.wallet)];
  const toIdx = (owner: string) => accountKeys.indexOf(owner);
  return {
    blockTime: fixture.blockTime,
    meta: {
      err: null,
      fee: fixture.fee,
      preBalances: accountKeys.map((k) => (k === fixture.wallet ? fixture.preBalancePayer : 0)),
      postBalances: accountKeys.map((k) => (k === fixture.wallet ? fixture.postBalancePayer : 0)),
      preTokenBalances: fixture.preTokenBalances.map((b) => ({ accountIndex: toIdx(b.owner), mint: b.mint, owner: b.owner, uiTokenAmount: { uiAmount: b.uiAmount, amount: '0', decimals: b.mint === USDC ? 6 : 9 } })),
      postTokenBalances: fixture.postTokenBalances.map((b) => ({ accountIndex: toIdx(b.owner), mint: b.mint, owner: b.owner, uiTokenAmount: { uiAmount: b.uiAmount, amount: '0', decimals: b.mint === USDC ? 6 : 9 } })),
    },
    transaction: { message: { accountKeys } },
  };
}

describe('REAL_MAINNET_FIXTURE — Jupiter SOL->USDC swap', () => {
  it('parses the wallet swap leg and does not reject it', () => {
    const events = parseSolanaTransaction(fixture.wallet, fixture.signature, asParsedTx());
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0];
    expect(ev.completeness).not.toBe('rejected');
    expect(ev.walletAddress).toBe(fixture.wallet);
    expect([ev.inputMint, ev.outputMint]).toContain(USDC);
    expect(ev.timestamp).toBe(fixture.blockTime * 1000);
  });

  it('captures the SOL leg and the real fee, not zero', () => {
    const events = parseSolanaTransaction(fixture.wallet, fixture.signature, asParsedTx());
    const ev = events[0];
    expect(ev.feeNative).toBeCloseTo(fixture.fee / 1e9, 12);
    const solLeg = ev.inputMint === SOL_MINT || ev.outputMint === SOL_MINT;
    expect(solLeg).toBe(true);
  });

  it('validateSwap accepts the parsed real swap', () => {
    const events = parseSolanaTransaction(fixture.wallet, fixture.signature, asParsedTx());
    const v = validateSwap(events[0], new Set());
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it('wallet balance delta is negative for SOL spent and positive for USDC received', () => {
    expect(fixture.postBalancePayer).toBeLessThan(fixture.preBalancePayer);
    const pre = fixture.preTokenBalances.find((b) => b.owner === fixture.wallet && b.mint === USDC);
    const post = fixture.postTokenBalances.find((b) => b.owner === fixture.wallet && b.mint === USDC);
    expect((post?.uiAmount ?? 0)).toBeGreaterThan(pre?.uiAmount ?? 0);
  });
});
