// Pure tests for the historical-price bar picker. No network, no I/O —
// `pickBarForTimestamp` is the seam the live oracle depends on, so its
// boundary behaviour (exact boundary, gaps, before-first, after-last,
// empty, invalid input) is pinned here.
import { describe, it, expect } from 'vitest'
import {
  pickBarForTimestamp,
  fetchTokenBarSeries,
  __setHistoricalPriceFetchForTests,
  __resetHistoricalPriceCacheForTests,
  type OhlcvBar,
} from '../historical-price'

// Bar times are epoch SECONDS, matching GeckoTerminal's ohlcv_list format.
function bar(time: number, close: number): OhlcvBar {
  return { time, open: close, high: close, low: close, close, volume: 0 }
}

describe('pickBarForTimestamp', () => {
  const bars = [bar(100, 1), bar(101, 2), bar(102, 3)] // 100–103, interval 1s

  it('exact bar boundary (atMs == bar.time) belongs to that bar', () => {
    expect(pickBarForTimestamp(bars, 101_000, 1)).toEqual(bars[1])
  })

  it('inside a bar window returns that bar', () => {
    expect(pickBarForTimestamp(bars, 102_500, 1)).toEqual(bars[2])
  })

  it('exact upper boundary (bar.time + interval) belongs to the NEXT bar', () => {
    // [101,102) contains 101000..101999; 102000 is bar[2]'s start.
    expect(pickBarForTimestamp(bars, 102_000, 1)).toEqual(bars[2])
  })

  it('before the first bar returns null', () => {
    expect(pickBarForTimestamp(bars, 99_999, 1)).toBeNull()
  })

  it('after the last bar falls back to the latest bar', () => {
    expect(pickBarForTimestamp(bars, 105_000, 1)).toEqual(bars[2])
  })

  it('empty bars returns null', () => {
    expect(pickBarForTimestamp([], 101_000, 1)).toBeNull()
  })

  it('non-finite or non-positive atMs returns null', () => {
    expect(pickBarForTimestamp(bars, Number.NaN, 1)).toBeNull()
    expect(pickBarForTimestamp(bars, Number.POSITIVE_INFINITY, 1)).toBeNull()
    expect(pickBarForTimestamp(bars, 0, 1)).toBeNull()
    expect(pickBarForTimestamp(bars, -5_000, 1)).toBeNull()
  })

  it('gap between bars falls back to the latest bar at-or-before atMs', () => {
    // bars at 100 and 110, 1s interval; 105 sits in a skipped window.
    const gapped = [bar(100, 1), bar(110, 2)]
    expect(pickBarForTimestamp(gapped, 105_000, 1)).toEqual(gapped[0])
  })

  it('skips non-finite bar times and uses minute intervals correctly', () => {
    const mixed: OhlcvBar[] = [
      { ...bar(Number.NaN, 0), time: Number.NaN },
      bar(1791969600, 100),
    ]
    // 1791969600 + 60s covers the next 59s.
    expect(pickBarForTimestamp(mixed, (1791969600 + 30) * 1000, 60)).toEqual(mixed[1])
    expect(pickBarForTimestamp(mixed, (1791969600 + 61) * 1000, 60)).toEqual(mixed[1])
  })
})

// The contract consumed by fetchHistoricalTokenUsd: real GeckoTerminal bars
// are seconds + close is USD — ensure the picker accepts them untouched.
describe('pickBarForTimestamp with real GeckoTerminal shape', () => {
  it('picks the bar containing a timestamp ~24h ago', () => {
    const atSec = 1791964800 // 2026-10-14T00:00:00Z
    const bars = [
      { time: 1791961200, open: 107.25, high: 107.62, low: 106.56, close: 107.26, volume: 3444321 },
      { time: 1791964800, open: 107.26, high: 108.59, low: 106.69, close: 107.17, volume: 8171051 },
    ]
    const got = pickBarForTimestamp(bars, atSec * 1000, 3_600)
    expect(got).not.toBeNull()
    expect(got?.close).toBeCloseTo(107.17, 2)
    expect(got?.volume).toBe(8171051)
  })

  it('a trade seconds before the bar end still prices at that bar', () => {
    const bars = [{ time: 1791964800, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]
    expect(pickBarForTimestamp(bars, (1791964800 + 3_599) * 1000, 3_600)?.close).toBe(1.5)
  })
})

describe('fetchTokenBarSeries (fetch-seam, no network)', () => {
  const POOL = 'poolPDA111'
  const MINT = 'MintSeriesAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

  function poolsBody(mint: string): string {
    return JSON.stringify({
      data: [
        {
          id: `solana_${POOL}`,
          type: 'pool',
          attributes: { address: POOL, reserve_in_usd: '1000000' },
          relationships: {
            base_token: { data: { id: `solana_${mint}`, type: 'token' } },
            quote_token: {
              data: { id: 'solana_So11111111111111111111111111111111111111112', type: 'token' },
            },
          },
        },
      ],
    })
  }

  function barsBody(): string {
    return JSON.stringify({
      data: {
        attributes: {
          ohlcv_list: [
            [1_700_000_000, 1, 1, 1, 1.5, 10],
            [1_700_003_600, 1.5, 1.5, 1.5, 2, 20],
          ],
        },
      },
    })
  }

  it('returns the token OHLCV series from its best pool', async () => {
    __resetHistoricalPriceCacheForTests()
    __setHistoricalPriceFetchForTests(async (url) => {
      if (url.includes('/ohlcv/')) return new Response(barsBody(), { status: 200 })
      return new Response(poolsBody(MINT), { status: 200 })
    })

    const res = await fetchTokenBarSeries(MINT, { timeframe: 'hour' })
    expect(res.source).toBe('geckoterminal:ohlcv')
    expect(res.poolAddress).toBe(POOL)
    expect(res.bars).toHaveLength(2)
    expect(res.bars[1].close).toBe(2)
    __setHistoricalPriceFetchForTests(null)
  })

  it('retries a 429 with a FRESH abort signal (a reused one is already aborted)', async () => {
    __resetHistoricalPriceCacheForTests()
    let poolCalls = 0
    __setHistoricalPriceFetchForTests(async (url, init) => {
      if (url.includes('/ohlcv/')) return new Response(barsBody(), { status: 200 })
      {
        poolCalls += 1
        if (poolCalls === 1) return new Response('{"status":{"error_code":429}}', { status: 429 })
        // The retry must arrive with a signal that is not already aborted.
        expect(init?.signal?.aborted).toBe(false)
        return new Response(poolsBody(MINT), { status: 200 })
      }
    })

    const res = await fetchTokenBarSeries(MINT, { timeframe: 'hour' })
    expect(poolCalls).toBe(2)
    expect(res.bars).toHaveLength(2)
    __setHistoricalPriceFetchForTests(null)
  })

  it('reports rate-limited distinctly from pool-not-found', async () => {
    __resetHistoricalPriceCacheForTests()
    __setHistoricalPriceFetchForTests(async () => new Response('{}', { status: 429 }))
    const res = await fetchTokenBarSeries(MINT, { timeframe: 'hour' })
    expect(res.source).toBe('geckoterminal:rate-limited')
    expect(res.bars).toHaveLength(0)
    __setHistoricalPriceFetchForTests(null)
  })
})
