// ─────────────────────────────────────────────────────────────
// persistSolanaTransactions — verifies the writer persists BOTH buy
// and sell legs with side + feeUsd, and that the upsert update clause
// carries those fields. Prisma is mocked; no DB touched.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
// Mock prisma before importing the module under test. The upsert mock
// is hoisted by vitest: the factory takes no external variables and
// returns a bare function we grab from the module registry instead.
vi.mock('@/lib/db', () => ({
  prisma: {
    transaction: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

import { persistSolanaTransactions, swapToTransactionRow } from '../wallet-refresh';
import { SOL_MINT, type NormalizedSwap } from '../solana-harvest';
import { prisma } from '@/lib/db';

const upsertSpy = prisma.transaction.upsert as unknown as Mock;
const NOW = 1_800_000_000_000;

function swap(over: Partial<NormalizedSwap>): NormalizedSwap {
  return {
    chain: 'solana',
    walletAddress: 'W',
    transactionSignature: 'tx-1',
    timestamp: NOW,
    inputMint: SOL_MINT,
    outputMint: 'MintA',
    inputAmount: 1,
    outputAmount: 100,
    inputUsd: 500,
    outputUsd: null,
    feeNative: 0.00001,
    feeUsd: 0.05,
    feeKnown: true,
    source: 'gmgn:wallet_activity',
    completeness: 'complete',
    limitations: [],
    ...over,
  };
}

beforeEach(() => {
  upsertSpy.mockClear();
  upsertSpy.mockResolvedValue({});
  process.env.PERSIST_SOLANA_TRANSACTIONS = 'true';
});

afterEach(() => {
  delete process.env.PERSIST_SOLANA_TRANSACTIONS;
});

describe('persistSolanaTransactions — buy and sell legs with fee+side', () => {
  it('persists both a buy and a sell leg, each with side and feeUsd', async () => {
    const swaps = [
      swap({ transactionSignature: 'buy-tx', inputMint: SOL_MINT, outputMint: 'TokenB', inputUsd: 300, feeUsd: 0.01 }),
      swap({ transactionSignature: 'sell-tx', inputMint: 'TokenB', outputMint: SOL_MINT, inputUsd: 450, feeUsd: 0.02 }),
      // rejected: token→token
      swap({ transactionSignature: 'skip-tx', inputMint: 'TokenA', outputMint: 'TokenB', inputUsd: 100 }),
      // rejected: partial
      swap({ transactionSignature: 'partial-tx', completeness: 'partial' }),
    ];

    const result = await persistSolanaTransactions('wallet-9', swaps);

    expect(result.enabled).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.eligible).toBe(2);
    expect(result.persisted).toBe(2);
    expect(result.failed).toBe(0);
    expect(upsertSpy).toHaveBeenCalledTimes(2);

    const first = upsertSpy.mock.calls[0][0];
    expect(first.create).toMatchObject({
      chain: 'solana',
      txHash: 'buy-tx',
      side: 'buy',
      feeUsd: 0.01,
      tokenAddress: 'TokenB',
      walletId: 'wallet-9',
    });
    expect(first.update).toMatchObject({ side: 'buy', feeUsd: 0.01, tokenAddress: 'TokenB' });

    const second = upsertSpy.mock.calls[1][0];
    expect(second.create).toMatchObject({
      chain: 'solana',
      txHash: 'sell-tx',
      side: 'sell',
      feeUsd: 0.02,
      tokenAddress: 'TokenB',
      walletId: 'wallet-9',
    });
    expect(second.update).toMatchObject({ side: 'sell', feeUsd: 0.02, tokenAddress: 'TokenB' });
  });

  it('preserves null feeUsd when fee was unknown', async () => {
    const swaps = [swap({ transactionSignature: 'nofee-tx', feeUsd: null })];
    const result = await persistSolanaTransactions('wallet-1', swaps);

    expect(result.persisted).toBe(1);
    const call = upsertSpy.mock.calls[0][0];
    expect(call.create.feeUsd).toBeNull();
    expect(call.update.feeUsd).toBeNull();
  });

  it('counts failures without throwing', async () => {
    upsertSpy.mockRejectedValueOnce(new Error('DB down'));
    const swaps = [swap({ transactionSignature: 'ok-tx' }), swap({ transactionSignature: 'bad-tx' })];
    const result = await persistSolanaTransactions('wallet-1', swaps);

    expect(result.persisted).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('dry-run when PERSIST_SOLANA_TRANSACTIONS is unset', async () => {
    delete process.env.PERSIST_SOLANA_TRANSACTIONS;
    const swaps = [swap({ transactionSignature: 'dry-tx' })];
    const result = await persistSolanaTransactions('wallet-1', swaps);

    expect(result.enabled).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.eligible).toBe(1);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('eligible count matches swapToTransactionRow null-filter (both buy+sell)', async () => {
    const swaps = [
      swap({ transactionSignature: 'b1', inputMint: SOL_MINT, outputMint: 'X', inputUsd: 10 }),
      swap({ transactionSignature: 's1', inputMint: 'X', outputMint: SOL_MINT, inputUsd: 20 }),
      swap({ transactionSignature: 'r1', completeness: 'rejected' as const, rejectReason: 'missing-meta' }),
    ];
    const result = await persistSolanaTransactions('w', swaps);
    expect(result.eligible).toBe(2);
  });
});

describe('swapToTransactionRow — side consistency', () => {
  it('buy row tokenAddress is the output (bought token), sell row tokenAddress is the input (sold token)', () => {
    const buy = swapToTransactionRow(
      swap({ inputMint: SOL_MINT, outputMint: 'Bought', inputUsd: 1 }),
    );
    expect(buy?.side).toBe('buy');
    expect(buy?.tokenAddress).toBe('Bought');

    const sell = swapToTransactionRow(
      swap({ inputMint: 'Sold', outputMint: SOL_MINT, inputUsd: 2 }),
    );
    expect(sell?.side).toBe('sell');
    expect(sell?.tokenAddress).toBe('Sold');
  });
});
