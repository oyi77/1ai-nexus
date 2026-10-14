// ─────────────────────────────────────────────────────────────
// Wallet refresh candidate selection — pure selector tests.
// No RPC, no DB. Proves never-classified priority, base58-first
// filtering, and stale oldest-first fill.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  selectRefreshCandidates,
  type WalletRefreshCandidateRow,
} from '../wallet-refresh';

const NOW = 1_800_000_000_000;
const STALE_MS = 24 * 60 * 60 * 1000;

/** Unique base58-shaped Solana address: `seed` + z-padding to 32 chars. */
const addr = (seed: string): string => seed + 'z'.repeat(Math.max(0, 32 - seed.length));

function row(over: Partial<WalletRefreshCandidateRow> & { id: string }): WalletRefreshCandidateRow {
  const { id, ...rest } = over;
  return {
    id,
    address: addr(id),
    chain: 'solana',
    classifiedAt: null,
    lastSeen: new Date(NOW),
    ...rest,
  };
}

const opts = { batchSize: 5, staleMs: STALE_MS, nowMs: NOW };

describe('selectRefreshCandidates', () => {
  it('prioritizes never-classified wallets even when fresh-classified rows are newer', () => {
    const rows = [
      row({ id: 'waa', classifiedAt: null, lastSeen: new Date(NOW - 1_000) }),
      row({ id: 'wab', classifiedAt: null, lastSeen: new Date(NOW - 2_000) }),
      // Fresh-classified rows with FRESH lastSeen must not crowd out the above.
      row({ id: 'wac', classifiedAt: new Date(NOW - 60_000), lastSeen: new Date(NOW) }),
      row({ id: 'wad', classifiedAt: new Date(NOW - 120_000), lastSeen: new Date(NOW - 1) }),
    ];
    const out = selectRefreshCandidates(rows, opts);
    expect(out.map((c) => c.walletId)).toEqual(['waa', 'wab']);
    expect(out.every((c) => c.reason === 'never-classified')).toBe(true);
  });

  it('never selects EVM-style 0x rows, even when never-classified', () => {
    const rows = [
      row({ id: 'waa', address: '0x0000000000000000000000000000000000000000', classifiedAt: null }),
      row({ id: 'wab', address: '0x1111111111111111111111111111111111111111', classifiedAt: null }),
      row({ id: 'wac', classifiedAt: null }),
    ];
    const out = selectRefreshCandidates(rows, opts);
    expect(out.map((c) => c.walletId)).toEqual(['wac']);
  });

  it('fills remaining slots with stale classified wallets, oldest classification first', () => {
    const rows = [
      row({ id: 'waa', classifiedAt: null }),
      // Stale: classified > 24h ago.
      row({ id: 'wab', classifiedAt: new Date(NOW - 3 * STALE_MS) }),
      row({ id: 'wac', classifiedAt: new Date(NOW - 2 * STALE_MS) }),
      row({ id: 'wad', classifiedAt: new Date(NOW - 4 * STALE_MS) }),
    ];
    const out = selectRefreshCandidates(rows, opts);
    expect(out.map((c) => c.walletId)).toEqual(['waa', 'wad', 'wab', 'wac']);
    expect(out[1].reason).toBe('stale-classification');
  });

  it('caps the batch at batchSize even with more never-classified rows', () => {
    const rows = [
      row({ id: 'waa', lastSeen: new Date(NOW - 1) }),
      row({ id: 'wab', lastSeen: new Date(NOW - 2) }),
      row({ id: 'wac', lastSeen: new Date(NOW - 3) }),
      row({ id: 'wad', lastSeen: new Date(NOW - 4) }),
      row({ id: 'wae', lastSeen: new Date(NOW - 5) }),
      row({ id: 'waf', lastSeen: new Date(NOW - 6) }),
    ];
    const out = selectRefreshCandidates(rows, opts);
    expect(out).toHaveLength(5);
    expect(out.map((c) => c.walletId)).toEqual(['waa', 'wab', 'wac', 'wad', 'wae']);
  });

  it('selects never-classified base58 rows regardless of old lastSeen', () => {
    const rows = [
      // Fresh-classified with new lastSeen must lose to the old never-classified.
      row({ id: 'waa', classifiedAt: new Date(NOW - 60_000), lastSeen: new Date(NOW) }),
      row({ id: 'wab', classifiedAt: null, lastSeen: new Date(NOW - 90 * 24 * 60 * 60 * 1000) }),
    ];
    const out = selectRefreshCandidates(rows, opts);
    expect(out.map((c) => c.walletId)).toEqual(['wab']);
  });

  it('excludes fresh-classified base58 rows', () => {
    const rows = [
      row({ id: 'waa', classifiedAt: new Date(NOW - 60_000) }),
      row({ id: 'wab', classifiedAt: new Date(NOW - STALE_MS) }), // exactly staleMs → not older
    ];
    const out = selectRefreshCandidates(rows, opts);
    expect(out).toEqual([]);
  });

  it('returns an empty list for empty rows', () => {
    expect(selectRefreshCandidates([], opts)).toEqual([]);
  });

  it('orders deterministically by lastSeen desc then id asc on ties', () => {
    const rows = [
      row({ id: 'wab', lastSeen: new Date(NOW) }),
      row({ id: 'waa', lastSeen: new Date(NOW) }),
      row({ id: 'wac', lastSeen: new Date(NOW) }),
    ];
    const out = selectRefreshCandidates(rows, opts);
    expect(out.map((c) => c.walletId)).toEqual(['waa', 'wab', 'wac']);
  });
});
