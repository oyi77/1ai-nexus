// ─────────────────────────────────────────────────────────────
// Fetch-with-Cache Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { cachedFetch, _clearCaches } from '../fetch-with-cache'

describe('cachedFetch', () => {
  beforeEach(() => {
    _clearCaches()
  })

  it('fetches data and returns ModuleResult shape', async () => {
    const result = await cachedFetch('test', { key: 'value' }, 10_000, async () => ({ data: 42 }))
    expect(result.data).toEqual({ data: 42 })
    expect(result.source).toBe('test')
    expect(result.cached).toBe(false)
    expect(result.timestamp).toBeGreaterThan(0)
    expect(result.ttl).toBe(10_000)
  })

  it('returns cached data on second call with same params', async () => {
    let callCount = 0
    const fetcher = async () => { callCount++; return { count: callCount } }

    const first = await cachedFetch('test', { a: 1 }, 60_000, fetcher)
    expect(first.cached).toBe(false)
    expect(first.data).toEqual({ count: 1 })

    const second = await cachedFetch('test', { a: 1 }, 60_000, fetcher)
    expect(second.cached).toBe(true)
    expect(second.data).toEqual({ count: 1 }) // Same data, fetcher not called again
    expect(callCount).toBe(1)
  })

  it('does not cache when params differ', async () => {
    let callCount = 0
    const fetcher = async () => { callCount++; return callCount }

    await cachedFetch('test', { a: 1 }, 60_000, fetcher)
    await cachedFetch('test', { a: 2 }, 60_000, fetcher)
    expect(callCount).toBe(2)
  })

  it('deduplicates concurrent requests for the same key (single-flight)', async () => {
    let callCount = 0
    const fetcher = async () => {
      callCount++
      // Simulate async work
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 50)
      await promise
      return { result: callCount }
    }

    // Fire 3 concurrent requests with same key
    const [r1, r2, r3] = await Promise.all([
      cachedFetch('test', { x: 1 }, 60_000, fetcher),
      cachedFetch('test', { x: 1 }, 60_000, fetcher),
      cachedFetch('test', { x: 1 }, 60_000, fetcher),
    ])

    // Only 1 actual fetch should have happened
    expect(callCount).toBe(1)
    // All 3 should get the same result
    expect(r1.data).toEqual({ result: 1 })
    expect(r2.data).toEqual({ result: 1 })
    expect(r3.data).toEqual({ result: 1 })
  })

  it('propagates fetcher errors', async () => {
    const failingFetcher = async () => { throw new Error('fetch failed') }
    await expect(cachedFetch('test', {}, 10_000, failingFetcher)).rejects.toThrow('fetch failed')
  })
})
