// ─────────────────────────────────────────────────────────────
// Solpump trenches adapter unit tests (fixture-backed, no network).
// Shapes mirrored from live trade.solpump.io/api/v2/scanner/trenches
// probes 2026-10-15 (POST body {}, paginated via nextCursor).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  fetchSolpumpTrenches,
  parseTrenchesResponse,
  isGraduatingSweetSpot,
  __resetSolpumpTrenchesForTests,
  type SolpumpTrenchToken,
} from '../trenches'
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
  __resetSolpumpTrenchesForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetSolpumpTrenchesForTests()
})

// ── Realistic fixtures (derived from live probe 2026-10-15) ──

/** PumpFun token at 92.1% bonding progress — classic sweet spot. */
const SWEET_SPOT_TOKEN: SolpumpTrenchToken = {
  chain: 'SOL',
  pairAddress: 'PAIR-SWEET-0001',
  tokenAddress: 'TOKN-SWEET-0000000000000000000000000001',
  tokenName: 'Sweet Spot Coin',
  tokenSymbol: 'SWEET',
  platformType: 'PUMPFUN',
  launchPad: {
    bondingCurve: { state: 'Migrating', progressPct: 92.1 },
    pumpfun: { kingOfTheHillTimestamp: 1760000000 },
  },
  rugged: false,
  createdAtAgeSeconds: 3_600,
}

/** PumpFun but only 50% progress — too early for the sweet spot. */
const EARLY_TOKEN: SolpumpTrenchToken = {
  ...SWEET_SPOT_TOKEN,
  pairAddress: 'PAIR-EARLY-0002',
  tokenAddress: 'TOKN-EARLY-0000000000000000000000000002',
  tokenSymbol: 'EARLY',
  launchPad: {
    bondingCurve: { state: 'Active', progressPct: 50.0 },
  },
}

/** PumpFun at 94% but rugged — must never pass the sweet-spot check. */
const RUGGED_TOKEN: SolpumpTrenchToken = {
  ...SWEET_SPOT_TOKEN,
  pairAddress: 'PAIR-RUGGED-03',
  tokenAddress: 'TOKN-RUGGED-000000000000000000000000003',
  tokenSymbol: 'RUGGED',
  rugged: true,
}

/** Raydium (non-PumpFun) platform — excluded by platformType. */
const RAYDIUM_TOKEN: SolpumpTrenchToken = {
  ...SWEET_SPOT_TOKEN,
  pairAddress: 'PAIR-RAY-00004',
  tokenAddress: 'TOKN-RAYDIUM-00000000000000000000000004',
  tokenSymbol: 'RAYD',
  platformType: 'RAYDIUM',
}

const PAGE_RESPONSE = (
  tokens: SolpumpTrenchToken[],
  nextCursor: string | null,
) => ({
  tokens,
  cursor: nextCursor ? '.page1' : null,
  nextCursor,
})

// ── Tests ──

describe('fetchSolpumpTrenches', () => {
  it('disabled: returns empty array and does not call fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchSolpumpTrenches('graduating')

    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('enabled: parses graduating rows with sweet-spot and non-sweet-spot tokens', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    mockFetchSequence([
      {
        status: 200,
        body: PAGE_RESPONSE([SWEET_SPOT_TOKEN, EARLY_TOKEN, RUGGED_TOKEN], null),
      },
    ])

    const result = await fetchSolpumpTrenches('graduating')

    expect(result).toHaveLength(3)
    expect(result[0].tokenAddress).toBe(SWEET_SPOT_TOKEN.tokenAddress)
    expect(result[0].launchPad?.bondingCurve?.state).toBe('Migrating')
    expect(result[1].launchPad?.bondingCurve?.progressPct).toBe(50.0)
    expect(result[2].rugged).toBe(true)
  })

  it('enabled: only sweet-spot tokens classify as graduating sweet spot', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    mockFetchSequence([
      {
        status: 200,
        body: PAGE_RESPONSE(
          [SWEET_SPOT_TOKEN, EARLY_TOKEN, RUGGED_TOKEN, RAYDIUM_TOKEN],
          null,
        ),
      },
    ])

    const result = await fetchSolpumpTrenches('graduating')
    const sweet = result.filter((t) => isGraduatingSweetSpot(t))

    expect(sweet).toHaveLength(1)
    expect(sweet[0].tokenSymbol).toBe('SWEET')
  })

  it('network error: returns empty array, no throw', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const result = await fetchSolpumpTrenches('graduating')

    expect(result).toEqual([])
  })

  it('non-200 response: returns empty array, no throw', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    mockFetchSequence([{ status: 403, body: { error: 'forbidden' } }])

    const result = await fetchSolpumpTrenches('graduating')

    expect(result).toEqual([])
  })

  it('malformed JSON body: returns empty array, no throw', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('not json at all', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await fetchSolpumpTrenches('graduating')

    expect(result).toEqual([])
  })

  it('paginates via nextCursor but caps at maxPages (default 3)', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    // Every page advertises a next cursor — the cap must stop the loop.
    const endlessPage = (n: number) =>
      PAGE_RESPONSE(
        [{ ...SWEET_SPOT_TOKEN, tokenAddress: `TOKN-PAGE-${n}` }],
        `.page${n + 1}`,
      )

    mockFetchSequence([
      { status: 200, body: endlessPage(1) },
      { status: 200, body: endlessPage(2) },
      { status: 200, body: endlessPage(3) },
      { status: 200, body: endlessPage(4) }, // never reached
    ])

    const result = await fetchSolpumpTrenches('graduating')

    expect(result).toHaveLength(3)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('custom maxPages overrides the default cap', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    const endlessPage = (n: number) =>
      PAGE_RESPONSE(
        [{ ...SWEET_SPOT_TOKEN, tokenAddress: `TOKN-PAGE-${n}` }],
        `.page${n + 1}`,
      )

    mockFetchSequence([
      { status: 200, body: endlessPage(1) },
      { status: 200, body: endlessPage(2) },
      { status: 200, body: endlessPage(3) },
    ])

    const result = await fetchSolpumpTrenches('graduating', { maxPages: 2 })

    expect(result).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('sends POST with JSON body to the phase endpoint', async () => {
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    __resetSolpumpTrenchesForTests()

    const fetchSpy = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(PAGE_RESPONSE([SWEET_SPOT_TOKEN], null)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await fetchSolpumpTrenches('graduated')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://trade.solpump.io/api/v2/scanner/trenches/graduated',
      expect.objectContaining({ method: 'POST' }),
    )
    const init = fetchSpy.mock.calls[0][1]
    expect(JSON.parse(init.body as string)).toEqual({})
  })
})

describe('parseTrenchesResponse', () => {
  it('parses a valid response body', () => {
    const parsed = parseTrenchesResponse(
      PAGE_RESPONSE([SWEET_SPOT_TOKEN], '.page2'),
    )

    expect(parsed.tokens).toHaveLength(1)
    expect(parsed.nextCursor).toBe('.page2')
  })

  it('returns empty tokens for malformed bodies', () => {
    expect(parseTrenchesResponse(null).tokens).toEqual([])
    expect(parseTrenchesResponse('nope').tokens).toEqual([])
    expect(parseTrenchesResponse({ wrong: 'shape' }).tokens).toEqual([])
    expect(parseTrenchesResponse({ tokens: 'not-an-array' }).tokens).toEqual([])
  })
})

describe('isGraduatingSweetSpot', () => {
  it('true for PumpFun in [85, 100) and not rugged', () => {
    expect(isGraduatingSweetSpot(SWEET_SPOT_TOKEN)).toBe(true)
    expect(
      isGraduatingSweetSpot({
        ...SWEET_SPOT_TOKEN,
        launchPad: { bondingCurve: { state: 'Active', progressPct: 85 } },
      }),
    ).toBe(true)
    expect(
      isGraduatingSweetSpot({
        ...SWEET_SPOT_TOKEN,
        launchPad: { bondingCurve: { state: 'Active', progressPct: 99.9 } },
      }),
    ).toBe(true)
  })

  it('false below 85, at 100, above 100, or missing progress', () => {
    const at = (pct: number): SolpumpTrenchToken => ({
      ...SWEET_SPOT_TOKEN,
      launchPad: { bondingCurve: { state: 'Active', progressPct: pct } },
    })
    expect(isGraduatingSweetSpot(at(84.9))).toBe(false)
    expect(isGraduatingSweetSpot(at(100))).toBe(false)
    expect(isGraduatingSweetSpot(at(120))).toBe(false)
    expect(isGraduatingSweetSpot({ ...SWEET_SPOT_TOKEN, launchPad: {} })).toBe(
      false,
    )
  })

  it('false for non-PumpFun platforms and rugged tokens', () => {
    expect(isGraduatingSweetSpot(RAYDIUM_TOKEN)).toBe(false)
    expect(isGraduatingSweetSpot(RUGGED_TOKEN)).toBe(false)
  })

  it('thresholds are configurable', () => {
    expect(
      isGraduatingSweetSpot(EARLY_TOKEN, { minProgressPct: 40 }),
    ).toBe(true)
    expect(
      isGraduatingSweetSpot(SWEET_SPOT_TOKEN, { maxProgressPct: 90 }),
    ).toBe(false)
  })
})
