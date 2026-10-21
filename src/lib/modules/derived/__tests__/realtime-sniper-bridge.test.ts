// Pure-part tests for the realtime sniper bridge.
// Zero network: the scan runner is always injected.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  envFlag,
  withinWindow,
  allowEvent,
  createRateLimitState,
  scoredTokenToCandidate,
  onRealtimeToken,
} from '../realtime-sniper-bridge'
import type { SniperScanResult } from '../sniper-scan'

beforeEach(() => {
  delete process.env.SNIPER_REALTIME_ENABLED
  delete process.env.SNIPER_REALTIME_MAX_EVENTS_PER_MIN
  delete process.env.SNIPER_DELIVER_WATCHLIST
})

afterEach(() => {
  delete process.env.SNIPER_REALTIME_ENABLED
  delete process.env.SNIPER_REALTIME_MAX_EVENTS_PER_MIN
  delete process.env.SNIPER_DELIVER_WATCHLIST
})

describe('envFlag', () => {
  it('only the literal "true" (case-insensitive, trimmed) is on; everything else is off', () => {
    expect(envFlag('true')).toBe(true)
    expect(envFlag(' True ')).toBe(true)
    expect(envFlag('false')).toBe(false)
    expect(envFlag(undefined)).toBe(false)
    expect(envFlag(null)).toBe(false)
    expect(envFlag('1')).toBe(false)
  })
})

describe('sliding-window rate limiter', () => {
  it('accepts up to the limit inside one window', () => {
    const state = createRateLimitState()
    const base = 1_000_000
    expect(allowEvent(state, base, 60_000, 3)).toBe(true) // 1st
    expect(allowEvent(state, base + 1000, 60_000, 3)).toBe(true) // 2nd
    expect(allowEvent(state, base + 2000, 60_000, 3)).toBe(true) // 3rd — inclusive
  })

  it('drops events past the limit inside the same window', () => {
    const state = createRateLimitState()
    const base = 2_000_000
    allowEvent(state, base, 60_000, 3)
    allowEvent(state, base + 1000, 60_000, 3)
    allowEvent(state, base + 2000, 60_000, 3)
    expect(allowEvent(state, base + 3000, 60_000, 3)).toBe(false) // 4th dropped
  })

  it('accepts again after the window rolls over', () => {
    const state = createRateLimitState()
    const base = 3_000_000
    allowEvent(state, base, 60_000, 2)
    allowEvent(state, base + 1000, 60_000, 2)
    // 61s later — first event is now outside the window.
    expect(allowEvent(state, base + 61_000, 60_000, 2)).toBe(true)
  })
})

describe('withinWindow (pruning helper)', () => {
  it('keeps in-window timestamps and drops out-of-window ones', () => {
    const events = [1000, 2000, 5000, 9999]
    expect(withinWindow(events, 10_000, 60_000)).toEqual(events) // all within 60s
    expect(withinWindow(events, 66_000, 60_000)).toEqual([9999]) // only the last survives
  })
})

describe('cooldown dedup (rate-limited pass count)', () => {
  // The per-contract cooldown is enforced by the shared sniper pipeline's
  // seen-state, not by the bridge. Here we prove the rate-limit gate
  // suppresses a second hit for the same contract within the window so the
  // pipeline never even sees it.

  it('allows the first event for a contract, then drops the second inside the window', () => {
    const state = createRateLimitState()
    const base = 4_000_000
    expect(allowEvent(state, base, 60_000, 1)).toBe(true)
    expect(allowEvent(state, base + 5000, 60_000, 1)).toBe(false)
  })

  it('allows again after the cooldown window expires', () => {
    const state = createRateLimitState()
    const base = 5_000_000
    allowEvent(state, base, 60_000, 1)
    expect(allowEvent(state, base + 61_000, 60_000, 1)).toBe(true)
  })
})

describe('env-gate decision (onRealtimeToken)', () => {
  function fakeResult(): SniperScanResult {
    return {
      scanned: 1,
      screened: 0,
      watchlisted: 0,
      rejected: 1,
      deduped: 0,
      delivered: 0,
      decisions: [],
      errors: [],
      categories: {},
    }
  }

  it('is inert (enabled=false) when the env flag is unset, even with a real token', async () => {
    const run = async () => fakeResult()
    const res = await onRealtimeToken({ address: 'ABC', chain: 'solana' }, run)
    expect(res.enabled).toBe(false)
    expect(res.skipped).toBe(true)
  })

  it('proceeds when the env flag is explicitly "true"', async () => {
    process.env.SNIPER_REALTIME_ENABLED = 'true'
    const res = await onRealtimeToken(
      { address: 'ABC', chain: 'solana' },
      async () => fakeResult(),
    )
    expect(res.enabled).toBe(true)
    expect(res.skipped).toBe(false)
    expect(res.result).toBeDefined()
  })
})

describe('ScoredToken → candidate conversion', () => {
  it('maps fields correctly and never invents safety facts', () => {
    const candidate = scoredTokenToCandidate({
      address: 'DezXAZ8z7PnrnRJjzxdUPFYkQFq6p',
      chain: 'solana',
      name: 'TestCoin',
      symbol: 'TEST',
      priceUsd: 0.001,
      fdv: 2_500_000,
      liquidity: 80_000,
      volume24h: 500_000,
      boosts: 12,
      score: 82,
      firstSeen: 1_727_000_000_000,
      sources: ['dexscreener'],
      swapCount: 5,
    })
    expect(candidate.contract).toBe('DezXAZ8z7PnrnRJjzxdUPFYkQFq6p')
    expect(candidate.chain).toBe('solana')
    expect(candidate.symbol).toBe('TEST')
    expect(candidate.name).toBe('TestCoin')
    expect(candidate.marketCap).toBe(2_500_000)
    expect(candidate.liquidity).toBe(80_000)
    expect(candidate.price).toBe(0.001)
    expect(candidate.volume24h).toBe(500_000)
    expect(candidate.createdAt).toBe(1_727_000_000_000)
    expect(candidate.audited).toBe(false)
    expect(candidate.riskKnown).toBe(false)
    expect(candidate.volume5m).toBeUndefined() // never faked from volume24h
    expect(candidate.discoveryEvidence?.[0]?.note).toContain('82/100')
  })

  it('falls back gracefully on missing fields (null safety)', () => {
    const candidate = scoredTokenToCandidate({ address: 'A1', chain: 'solana' })
    expect(candidate.contract).toBe('A1')
    expect(candidate.symbol).toBe('A1'.slice(0, 8)) // contract-derived label
    expect(candidate.name).toBe('A1'.slice(0, 8))
    expect(candidate.price).toBe(0)
    expect(candidate.marketCap).toBe(0)
    expect(candidate.liquidity).toBe(0)
    expect(candidate.volume24h).toBe(0)
    expect(candidate.createdAt).toBeNull() // null → stricter post-bonding gates
    expect(candidate.audited).toBe(false)
    expect(candidate.riskKnown).toBe(false)
  })

  it('defaults chain to solana when absent', () => {
    const candidate = scoredTokenToCandidate({ address: '0xabc', chain: '' })
    expect(candidate.chain).toBe('solana')
  })
})
