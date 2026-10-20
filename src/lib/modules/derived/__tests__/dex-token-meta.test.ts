// ─────────────────────────────────────────────────────────────
// dex-token-meta tests — pure parser + batched fetcher (network
// mocked via globalThis.fetch, zero live calls).
//
// Covers: one-pair-per-mint selection by deepest liquidity, fdv
// fallback for marketCap, missing pair stays absent (never zero),
// batching ≤10 addresses per request, per-batch failure isolation.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseDexPairs, fetchDexTokenMeta, type DexPairLite } from '../dex-token-meta'

const MINT = 'WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp'
const MINT2 = '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx'
const MINT_DEAD = '111111111111111111111111111111111111111111'

function pair(over: Partial<DexPairLite> & { baseAddress: string }): DexPairLite {
  const { baseAddress, ...rest } = over
  return {
    chainId: 'solana',
    marketCap: 1_000_000,
    liquidity: { usd: 40_000 },
    baseToken: { address: baseAddress, symbol: 'XMR' },
    ...rest,
  }
}

function fakeMint(i: number): string {
  return `M${String(i).padStart(43, 'F')}`
}

function stubFetch(impl: () => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('parseDexPairs', () => {
  it('keeps the deepest-liquidity pair per mint and maps symbol/MC/liquidity', () => {
    const out = parseDexPairs(
      [MINT, MINT2],
      [
        pair({ baseAddress: MINT, liquidity: { usd: 12_000 }, marketCap: 900, pairCreatedAt: 1_700_000_000, volume: { h24: 111 } }),
        pair({ baseAddress: MINT, liquidity: { usd: 42_000 }, marketCap: 1_446_822, pairCreatedAt: 1_792_000_000, volume: { h24: 5_000 } }),
        pair({ baseAddress: MINT2, baseToken: { address: MINT2, symbol: '' } }),
      ],
    )
    expect(out.size).toBe(2)
    expect(out.get(MINT)).toEqual({
      symbol: 'XMR',
      marketCapUsd: 1_446_822,
      liquidityUsd: 42_000,
      pairCreatedAtMs: 1_792_000_000,
      volume24hUsd: 5_000,
    })
    expect(out.get(MINT2)).toEqual({ symbol: null, marketCapUsd: 1_000_000, liquidityUsd: 40_000, pairCreatedAtMs: null, volume24hUsd: null })
  })

  it('ignores pairs whose base token is not a requested contract', () => {
    const out = parseDexPairs([MINT], [pair({ baseAddress: MINT2 })])
    expect(out.size).toBe(0)
  })

  it('falls back to fdv when marketCap is missing or zero', () => {
    const out = parseDexPairs([MINT], [pair({ baseAddress: MINT, marketCap: 0, fdv: 777_000 })])
    expect(out.get(MINT)?.marketCapUsd).toBe(777_000)
  })

  it('skips null/garbage rows instead of throwing (one bad row cannot kill a batch)', () => {
    const out = parseDexPairs(
      [MINT],
      [null as never, undefined as never, 'nope' as never, pair({ baseAddress: MINT })],
    )
    expect(out.get(MINT)?.symbol).toBe('XMR')
  })

  it('leaves mints with no resolvable pair absent — never fabricated to zero', () => {
    const out = parseDexPairs([MINT, MINT_DEAD], [pair({ baseAddress: MINT })])
    expect(out.has(MINT)).toBe(true)
    expect(out.has(MINT_DEAD)).toBe(false)
  })
})

describe('fetchDexTokenMeta', () => {
  beforeEach(() => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify([pair({ baseAddress: MINT })]), { status: 200 }),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends one batched request for ≤10 contracts and maps the rows', async () => {
    const meta = await fetchDexTokenMeta([MINT, MINT2])

    const fetchMock = vi.mocked(globalThis.fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/tokens/v1/solana/')
    expect(url).toContain(MINT)

    expect(meta.get(MINT)?.symbol).toBe('XMR')
    expect(meta.get(MINT)?.marketCapUsd).toBe(1_000_000)
    expect(meta.has(MINT2)).toBe(false) // API returned no pair for it
  })

  it('splits >10 contracts into multiple requests', async () => {
    const mints = Array.from({ length: 23 }, (_, i) => fakeMint(i))
    await fetchDexTokenMeta(mints)
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(3) // 10 + 10 + 3
  })

  it('tolerates a failed batch — other batches still resolve', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const mints = [...Array.from({ length: 10 }, (_, i) => fakeMint(i)), MINT]
    const meta = await fetchDexTokenMeta(mints)
    expect(meta.get(MINT)?.symbol).toBe('XMR')
  })

  it('returns empty for an unreachable API without throwing', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    const meta = await fetchDexTokenMeta([MINT])
    expect(meta.size).toBe(0)
  })

  it('returns empty without any request for an empty contract list', async () => {
    const meta = await fetchDexTokenMeta([])
    expect(meta.size).toBe(0)
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled()
  })
})
