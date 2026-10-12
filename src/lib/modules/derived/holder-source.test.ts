// ─────────────────────────────────────────────────────────────
// Holder-source switch — env precedence + fallback selection.
// Pure selection logic; the RPC/HTTP paths are stubbed via global fetch
// so no network is touched.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// The gmgn adapter is a separate module that would hit Cloudflare. Stub it
// so these tests stay offline and deterministic; the helius leg is then
// reached only via the mocked global fetch below.
const gmgnHolders = vi.fn(async (...a: unknown[]): Promise<unknown[]> => []);
vi.mock('@/lib/modules/meme/gmgn', () => ({
  listGmgnTokenHolders: (...a: unknown[]) => gmgnHolders(...a),
}));

import { holderSource, fetchTopHolders } from './wallet-tracer';

const ENV_KEYS = ['HOLDER_SOURCE', 'HELIUS_API_KEY', 'SOLANA_RPC_URL', 'SOLANA_RPC_URLS', 'GMGN_SESSION_COOKIE'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('holderSource', () => {
  it('defaults to gmgn when unset', () => {
    expect(holderSource()).toBe('gmgn');
  });
  it('accepts helius and auto, case-insensitively', () => {
    process.env.HOLDER_SOURCE = 'HELIUS';
    expect(holderSource()).toBe('helius');
    process.env.HOLDER_SOURCE = 'Auto';
    expect(holderSource()).toBe('auto');
  });
  it('falls back to gmgn on an unknown value', () => {
    process.env.HOLDER_SOURCE = 'bogus';
    expect(holderSource()).toBe('gmgn');
  });
});

describe('fetchTopHolders source selection', () => {
  it('helius source parses largest-account owners into seeds', async () => {
    process.env.HOLDER_SOURCE = 'helius';
    process.env.SOLANA_RPC_URL = 'https://rpc.test';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { value: [{ address: 'TA1', amount: '1000000000' }] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { value: { data: { parsed: { info: { owner: 'WalletA', decimals: 9 } } } } },
          }),
          { status: 200 },
        ),
      );
    const rows = await fetchTopHolders('MintX', 5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe('WalletA');
    expect(rows[0].amount).toBe(1); // 1e9 raw / 1e9 decimals
    // Address-only source must not assert PnL.
    expect(rows[0].realizedProfit).toBeNull();
    expect(rows[0].usdValue).toBe(0);
    expect(rows[0].tags).toContain('helius-holder');
  });

  it('returns [] when no RPC url is configured', async () => {
    process.env.HOLDER_SOURCE = 'helius';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const rows = await fetchTopHolders('MintX', 5);
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto falls back to helius when the gmgn path yields nothing', async () => {
    process.env.HOLDER_SOURCE = 'auto';
    process.env.SOLANA_RPC_URL = 'https://rpc.test';
    // GMGN is a separate module call (no HTTP here) that returns [] without a
    // cookie; the helius leg then issues the two RPC posts below.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { value: [] } }), { status: 200 }),
    );
    const rows = await fetchTopHolders('MintX', 5);
    // Reached the helius leg (>=1 RPC call) rather than short-circuiting.
    expect(fetchMock).toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});
