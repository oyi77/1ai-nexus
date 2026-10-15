// ─────────────────────────────────────────────────────────────
// Solpump dev-tokens adapter unit tests (fixture-backed, no network).
// Shape mirrored from live trade.solpump.io/api/v2/token/SOL/{addr}/
// dev-tokens probe 2026-10-15.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  fetchDevTokenHistory,
  parseDevTokensResponse,
  __resetSolpumpDevTokensForTests,
} from '../dev-tokens'
import { __resetSolpumpFetchForTests } from '../solpump-fetch'

// ── Helpers ──

function mockFetchSequence(bodies: Array<{ status: number; body: unknown }>) {
  const queue = [...bodies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = queue.shift() ?? { status: 500, body: {} }
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

beforeEach(() => {
  delete process.env.SOLPUMP_TRENCHES_ENABLED
  delete process.env.SOLPUMP_REQUEST_GAP_MS
  delete process.env.SOLPUMP_MAX_RETRIES
  // Unit tests assert single-response semantics, not transport pacing —
  // zero gap + zero retries keeps them fast without changing behavior.
  process.env.SOLPUMP_REQUEST_GAP_MS = '0'
  process.env.SOLPUMP_MAX_RETRIES = '0'
  __resetSolpumpFetchForTests()
  __resetSolpumpDevTokensForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetSolpumpDevTokensForTests()
})

// ── Realistic fixture (derived from live probe 2026-10-15) ──

const DEV_HISTORY_RESPONSE = {
  devAddress: 'DEVWALLET1111111111111111111111111111111',
  tokens: [
    {
      tokenAddress: 'TOKN-OLD-00000000000000000000000000001',
      tokenName: 'First Launch',
      tokenSymbol: 'FIRST',
      chain: 'SOL',
      createdAtAgeSeconds: 86_400 * 30,
      migrated: true,
      migrationPct: 100,
      priceUsd: 0.00042,
    },
    {
      tokenAddress: 'TOKN-RUG-000000000000000000000000002',
      tokenName: 'Rug Pull Two',
      tokenSymbol: 'RUG2',
      chain: 'SOL',
      createdAtAgeSeconds: 86_400 * 10,
      migrated: false,
      migrationPct: 12.5,
      priceUsd: 0.000001,
    },
  ],
}

// ── Tests ──

describe('fetchDevTokenHistory', () => {
  it('disabled: returns empty payload and does not call fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchDevTokenHistory('SOL', 'TOKN-XYZ')

    expect(result).toEqual({ devAddress: null, tokens: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('enabled: returns DevHistoryInput-compatible payload', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpDevTokensForTests()

    mockFetchSequence([{ status: 200, body: DEV_HISTORY_RESPONSE }])

    const result = await fetchDevTokenHistory(
      'SOL',
      'TOKN-CURRENT-00000000000000000000000003',
    )

    expect(result.devAddress).toBe('DEVWALLET1111111111111111111111111111111')
    expect(result.tokens).toHaveLength(2)
    expect(result.tokens[0].migrated).toBe(true)
    expect(result.tokens[0].migrationPct).toBe(100)
    expect(result.tokens[1].rugged).toBeUndefined()
  })

  it('enabled: GETs the dev-tokens endpoint for the given chain+address', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpDevTokensForTests()

    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(DEV_HISTORY_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await fetchDevTokenHistory('SOL', 'TOKN-XYZ')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://trade.solpump.io/api/v2/token/SOL/TOKN-XYZ/dev-tokens',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) }),
    )
  })

  it('network error: returns empty payload with devAddress null, no throw', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpDevTokensForTests()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const result = await fetchDevTokenHistory('SOL', 'TOKN-XYZ')

    expect(result).toEqual({ devAddress: null, tokens: [] })
  })

  it('non-200 response: returns empty payload, no throw', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpDevTokensForTests()

    mockFetchSequence([{ status: 429, body: { error: 'rate limited' } }])

    const result = await fetchDevTokenHistory('SOL', 'TOKN-XYZ')

    expect(result).toEqual({ devAddress: null, tokens: [] })
  })

  it('malformed JSON body: returns empty payload, no throw', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpDevTokensForTests()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('not json at all', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await fetchDevTokenHistory('SOL', 'TOKN-XYZ')

    expect(result).toEqual({ devAddress: null, tokens: [] })
  })
})

describe('parseDevTokensResponse', () => {
  it('parses a valid response body', () => {
    const parsed = parseDevTokensResponse(DEV_HISTORY_RESPONSE)

    expect(parsed.devAddress).toBe('DEVWALLET1111111111111111111111111111111')
    expect(parsed.tokens).toHaveLength(2)
  })

  it('returns null devAddress / empty tokens for malformed bodies', () => {
    expect(parseDevTokensResponse(null)).toEqual({ devAddress: null, tokens: [] })
    expect(parseDevTokensResponse('nope')).toEqual({ devAddress: null, tokens: [] })
    expect(parseDevTokensResponse({ wrong: 1 })).toEqual({ devAddress: null, tokens: [] })
    expect(
      parseDevTokensResponse({ devAddress: 42, tokens: 'not-an-array' }),
    ).toEqual({ devAddress: null, tokens: [] })
  })
})
