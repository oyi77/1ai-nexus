// ─────────────────────────────────────────────────────────────
// Solpump shared HTTP client unit tests (fixture-backed, no network).
// Covers the burst protection contract: module-level spacing across
// adapters, retry backoff on 400/429/5xx, terminal non-retryable passthrough.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { solpumpFetch, __resetSolpumpFetchForTests } from '../solpump-fetch'

function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  process.env.SOLPUMP_REQUEST_GAP_MS = '0'
  process.env.SOLPUMP_MAX_RETRIES = '0'
  __resetSolpumpFetchForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete process.env.SOLPUMP_REQUEST_GAP_MS
  delete process.env.SOLPUMP_MAX_RETRIES
  __resetSolpumpFetchForTests()
})

describe('solpumpFetch', () => {
  it('returns the terminal non-retryable response as-is', async () => {
    process.env.SOLPUMP_MAX_RETRIES = '2'
    __resetSolpumpFetchForTests()
    const fetchSpy = vi.fn(async () => new Response('nope', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)

    const res = await solpumpFetch('https://trade.solpump.io/x', {})

    expect(res.status).toBe(404)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries retryable statuses up to SOLPUMP_MAX_RETRIES then returns the last response', async () => {
    process.env.SOLPUMP_MAX_RETRIES = '2'
    __resetSolpumpFetchForTests()
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 400 }))
    vi.stubGlobal('fetch', fetchSpy)

    const res = await solpumpFetch('https://trade.solpump.io/x', {})

    expect(res.status).toBe(400)
    expect(fetchSpy).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('recovers when a retry succeeds', async () => {
    process.env.SOLPUMP_MAX_RETRIES = '2'
    __resetSolpumpFetchForTests()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        return calls === 1 ? new Response('{}', { status: 429 }) : ok({ fine: true })
      }),
    )

    const res = await solpumpFetch('https://trade.solpump.io/x', {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ fine: true })
  })

  it('re-throws network errors after the retry budget is exhausted', async () => {
    process.env.SOLPUMP_MAX_RETRIES = '1'
    __resetSolpumpFetchForTests()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    await expect(solpumpFetch('https://trade.solpump.io/x', {})).rejects.toThrow('fetch failed')
  })

  it('serializes concurrent callers with the configured gap between requests', async () => {
    process.env.SOLPUMP_REQUEST_GAP_MS = '50'
    __resetSolpumpFetchForTests()
    const firedAt: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        firedAt.push(Date.now())
        return ok()
      }),
    )

    // Three overlapping logical requests — one adapter fan-out burst.
    const [a, b, c] = await Promise.all([
      solpumpFetch('https://trade.solpump.io/a', {}),
      solpumpFetch('https://trade.solpump.io/b', {}),
      solpumpFetch('https://trade.solpump.io/c', {}),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(c.status).toBe(200)
    expect(firedAt).toHaveLength(3)
    // Every pair of consecutive fires respects the module-level gap.
    expect(firedAt[1] - firedAt[0]).toBeGreaterThanOrEqual(45)
    expect(firedAt[2] - firedAt[1]).toBeGreaterThanOrEqual(45)
  })
})
