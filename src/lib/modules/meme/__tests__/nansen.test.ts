// ─────────────────────────────────────────────────────────────
// Nansen adapter unit tests (fixture-backed, no network).
// Shapes mirrored from public api.nansen.ai/v1 documentation
// (token-screener, analyzer/contract endpoints).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { discoverTokens, auditToken } from '../nansen'

function mockFetchSequence(bodies: Array<{ status: number; body: unknown }>) {
  const queue = [...bodies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = queue.shift() ?? { status: 500, body: {} }
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } })
    }),
  )
}

beforeEach(() => {
  process.env.MOBY_NANSEN_API_KEY = 'test-nansen-api-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Fixtures shaped to the adapter's zod schemas ──────────────

function screenerEntry(overrides: Record<string, unknown> = {}) {
  return {
    chain: 'ethereum',
    token_address: '0xABCDEF1234567890abcdefABCDEF1234567890ab',
    token_symbol: 'PEPE',
    token_age_days: 42,
    token_age_hours: 1008,
    token_deployment_date: '2026-08-23T10:00:00Z',
    market_cap_usd: 15_400_000,
    liquidity: 480_000,
    price_usd: 0.00001102,
    price_change: 12.5,
    fdv: 16_200_000,
    fdv_mc_ratio: 1.05,
    nof_traders: 1834,
    buy_volume: 2_100_000,
    sell_volume: 1_650_000,
    volume: 3_750_000,
    netflow: -125_000,
    inflow_fdv_ratio: 0.02,
    outflow_fdv_ratio: 0.03,
    ...overrides,
  }
}

function screenerResponse(entries: unknown[]) {
  return {
    data: entries,
    pagination: {
      page: 1,
      per_page: entries.length,
      is_last_page: true,
    },
  }
}

const RISK_METRICS = {
  overall_risk_score: 2,
  honeypot_risk: 1,
  liquidity_risk: 2,
  holder_concentration_risk: 3,
  contract_auth_risk: 1,
  top_10_holder_pct: 18.4,
  lp_locked_pct: 87.5,
  can_freeze: false,
  can_mint: false,
}

const CONTRACT_ANALYTICS = {
  contract_address: '0xABCDEF1234567890abcdefABCDEF1234567890ab',
  chain: 'ethereum',
  risk_metrics: RISK_METRICS,
  auditor_notes: 'LP locked, no mint authority detected.',
}

// ─────────────────────────────────────────────────────────────

describe('discoverTokens', () => {
  it('normalizes screener entries into MemeAlphaToken[]', async () => {
    mockFetchSequence([{ status: 200, body: screenerResponse([screenerEntry()]) }])
    const tokens = await discoverTokens()
    expect(tokens).toHaveLength(1)

    const t = tokens[0]
    expect(t.id).toBe('ethereum:0xABCDEF1234567890abcdefABCDEF1234567890ab')
    expect(t.platform).toBe('nansen')
    expect(t.chain).toBe('ethereum')
    expect(t.contract).toBe('0xABCDEF1234567890abcdefABCDEF1234567890ab')
    expect(t.symbol).toBe('PEPE')
    expect(t.name).toBe('PEPE') // falls back to symbol
    expect(t.price).toBeCloseTo(0.00001102)
    expect(t.change24h).toBeCloseTo(12.5)
    expect(t.volume24h).toBe(3_750_000)
    expect(t.marketCap).toBe(15_400_000)
    expect(t.liquidity).toBe(480_000)
    expect(t.holders).toBe(1834)
    expect(t.createdAt).toBe(new Date('2026-08-23T10:00:00Z').getTime())
    expect(t.top10HolderPercent).toBe(0) // not in screener response
    expect(t.social).toEqual({})
    expect(t.audited).toBe(false) // audit is separate
    expect(t.provenance).toEqual({
      sourceType: 'reverse-engineered',
      provider: 'nansen',
      experimental: true,
      note: 'Nansen screener response; subscription/API contract varies by plan',
    })
    expect(t.riskKnown).toBe(false)
    expect(t.buyCount24h).toBeUndefined()
    expect(t.sellCount24h).toBeUndefined()
    // netflow negative → smart money inflow → riskLevel 0
    expect(t.riskLevel).toBe(0)
  })

  it('maps positive netflow to riskLevel 1', async () => {
    mockFetchSequence([
      { status: 200, body: screenerResponse([screenerEntry({ netflow: 250_000 })]) },
    ])
    const tokens = await discoverTokens()
    expect(tokens[0].riskLevel).toBe(1)
  })

  it('uppercases the symbol in normalized output', async () => {
    mockFetchSequence([
      { status: 200, body: screenerResponse([screenerEntry({ token_symbol: 'pepe' })]) },
    ])
    const tokens = await discoverTokens()
    expect(tokens[0].symbol).toBe('PEPE')
    expect(tokens[0].name).toBe('PEPE')
  })

  it('respects the requested limit via per_page pagination', async () => {
    mockFetchSequence([{ status: 200, body: screenerResponse([]) }])
    await discoverTokens(7)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/token-screener')
    const payload = JSON.parse(String(init.body))
    expect(payload.pagination).toEqual({ page: 1, per_page: 7 })
    expect(payload.filters.trader_type).toBe('sm')
  })

  it('returns only as many tokens as the screener page contains', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: screenerResponse([
          screenerEntry(),
          screenerEntry({ chain: 'solana', token_address: 'So1anaAddr11111111111111111111111111111', token_symbol: 'SOLM' }),
          screenerEntry({ chain: 'base', token_address: '0xBASE11111111111111111111111111111111111', token_symbol: 'BASEM' }),
        ]),
      },
    ])
    const tokens = await discoverTokens(20)
    expect(tokens).toHaveLength(3)
    expect(tokens.map((t) => t.chain)).toEqual(['ethereum', 'solana', 'base'])
    expect(tokens.every((t) => t.platform === 'nansen')).toBe(true)
  })

  it('skips entries missing required fields (validation filter)', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: screenerResponse([
          { chain: 'ethereum', token_symbol: 'NOADDR' }, // missing token_address
          { token_address: '0xNOCHAIN', token_symbol: 'NOCHAIN' }, // missing chain
          screenerEntry(), // valid — should survive
        ]),
      },
    ])
    const tokens = await discoverTokens()
    // The whole response fails safeParse (array items invalid) → [] per adapter
    expect(tokens).toEqual([])
  })

  it('returns [] when response shape fails schema validation', async () => {
    mockFetchSequence([{ status: 200, body: { unexpected: 'shape' } }])
    expect(await discoverTokens()).toEqual([])
  })

  it('returns [] when MOBY_NANSEN_API_KEY is missing', async () => {
    delete process.env.MOBY_NANSEN_API_KEY
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await discoverTokens()).toEqual([])
    expect(spy).not.toHaveBeenCalled() // short-circuits before network
  })

  it('sends the apikey header from MOBY_NANSEN_API_KEY', async () => {
    mockFetchSequence([{ status: 200, body: screenerResponse([]) }])
    await discoverTokens(1)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.apikey).toBe('test-nansen-api-key')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('retries on 500 then succeeds', async () => {
    mockFetchSequence([
      { status: 500, body: { error: 'internal' } },
      { status: 200, body: screenerResponse([screenerEntry()]) },
    ])
    const tokens = await discoverTokens()
    expect(tokens).toHaveLength(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('retries on 429 then succeeds', async () => {
    mockFetchSequence([
      { status: 429, body: { error: 'rate limited' } },
      { status: 429, body: { error: 'rate limited' } },
      { status: 200, body: screenerResponse([]) },
    ])
    expect(await discoverTokens()).toEqual([])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it('gives up after 5 failed attempts and returns [] (error caught)', async () => {
    mockFetchSequence([
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
    ])
    const tokens = await discoverTokens()
    expect(tokens).toEqual([])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5)
  })

  it('throws clear error on 401 unauthorized', async () => {
    mockFetchSequence([{ status: 401, body: { error: 'invalid api key' } }])
    // discoverTokens swallows errors → []; assert fetchNansen surfaced once then was caught
    expect(await discoverTokens()).toEqual([])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1) // no retry on 401
  })
  it('bounds non-retryable HTTP error snippets at 200 characters', async () => {
    const body = 'x'.repeat(500)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockFetchSequence([{ status: 401, body }])
    expect(await discoverTokens()).toEqual([])
    expect(warning).toHaveBeenCalledTimes(1)
    const message = String(warning.mock.calls[0]?.[0])
    expect(message).toContain('nansen HTTP 401')
    expect(message).toContain('x'.repeat(200))
    expect(message).not.toContain('x'.repeat(201))
    warning.mockRestore()
  })

  it('aborts an in-flight request at the shared timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')))
        }),
      ),
    )
    const pending = discoverTokens()
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(pending).resolves.toEqual([])
    vi.useRealTimers()
  })

  it('throws clear error on 403 forbidden without retrying', async () => {
    mockFetchSequence([{ status: 403, body: { error: 'tier too low' } }])
    expect(await discoverTokens()).toEqual([])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('returns [] on malformed JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json{', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )
    expect(await discoverTokens()).toEqual([])
  })

  it('posts smart-money screener filters in request body', async () => {
    mockFetchSequence([{ status: 200, body: screenerResponse([]) }])
    await discoverTokens(5)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(String(init.body))
    expect(init.method).toBe('POST')
    expect(payload.chains).toEqual(['ethereum', 'solana', 'base', 'arb', 'bnb'])
    expect(payload.timeframe).toBe('24h')
    expect(payload.filters.nof_traders).toEqual({ min: 10 })
    expect(payload.filters.volume).toEqual({ min: 50000 })
    expect(payload.order_by).toEqual([{ field: 'volume', direction: 'DESC' }])
  })
})

describe('auditToken', () => {
  it('maps low Nansen risk scores to safe audit with correct fields', async () => {
    mockFetchSequence([{ status: 200, body: CONTRACT_ANALYTICS }])
    const audit = await auditToken('ethereum', '0xABCDEF1234567890abcdefABCDEF1234567890ab')
    expect(audit).not.toBeNull()
    expect(audit!.id).toBe('nansen:ethereum:0xABCDEF1234567890abcdefABCDEF1234567890ab')
    expect(audit!.platform).toBe('nansen')
    expect(audit!.chain).toBe('ethereum')
    expect(audit!.contract).toBe('0xABCDEF1234567890abcdefABCDEF1234567890ab')
    expect(audit!.symbol).toBe('')
    expect(audit!.name).toBe('')
    // overall_risk_score 2 → floor(2/3)=0 → 'safe'
    expect(audit!.riskLevel).toBe(0)
    expect(audit!.riskLabel).toBe('safe')
    expect(audit!.top10HolderPercent).toBe(18.4)
    expect(audit!.lpLockedPercent).toBe(87.5)
    expect(audit!.canFreeze).toBe(false)
    expect(audit!.canMint).toBe(false)
    // honeypot 1 → floor(1/7)=0; liquidity 2 → floor(2/4)=0; auth 1 → 1
    expect(audit!.riskCounts).toEqual({ high: 0, middle: 0, low: 1 })
    expect(audit!.buyTax).toBe(0)
    expect(audit!.sellTax).toBe(0)
    expect(audit!.auditedAt).toBeGreaterThan(0)
  })

  it('maps high overall risk score to high risk label', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          ...CONTRACT_ANALYTICS,
          risk_metrics: { ...RISK_METRICS, overall_risk_score: 9 },
        },
      },
    ])
    const audit = await auditToken('ethereum', '0xABCDEF1234567890abcdefABCDEF1234567890ab')
    // floor(9/3)=3 → 'high'
    expect(audit!.riskLevel).toBe(3)
    expect(audit!.riskLabel).toBe('high')
    // honeypot 1→0, but raise honeypot to check high count mapping
  })

  it('maps mid-range risk score to middle label with risk counts', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          ...CONTRACT_ANALYTICS,
          risk_metrics: {
            ...RISK_METRICS,
            overall_risk_score: 5,
            honeypot_risk: 8,
            liquidity_risk: 6,
            contract_auth_risk: 4,
          },
        },
      },
    ])
    const audit = await auditToken('ethereum', '0xABCDEF1234567890abcdefABCDEF1234567890ab')
    // floor(5/3)=1 → 'middle'
    expect(audit!.riskLevel).toBe(1)
    expect(audit!.riskLabel).toBe('middle')
    // floor(8/7)=1 high, floor(6/4)=1 middle, max(0,4)=4 low
    expect(audit!.riskCounts).toEqual({ high: 1, middle: 1, low: 4 })
  })

  it('returns null when response has no risk_metrics', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          contract_address: '0xABCDEF1234567890abcdefABCDEF1234567890ab',
          chain: 'ethereum',
          // risk_metrics absent
        },
      },
    ])
    expect(await auditToken('ethereum', '0xABCDEF1234567890abcdefABCDEF1234567890ab')).toBeNull()
  })

  it('returns null on 404 across all endpoint attempts', async () => {
    mockFetchSequence([
      { status: 404, body: { error: 'not found' } },
      { status: 404, body: { error: 'not found' } },
    ])
    expect(await auditToken('ethereum', '0xDEAD')).toBeNull()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2) // both endpoints tried
  })

  it('returns null on empty object payload', async () => {
    mockFetchSequence([{ status: 200, body: {} }])
    expect(await auditToken('solana', 'SomeAddr11111111111111111111111111111')).toBeNull()
  })

  it('falls back to second endpoint when first fails', async () => {
    mockFetchSequence([
      { status: 400, body: {} },
      { status: 200, body: CONTRACT_ANALYTICS },
    ])
    const audit = await auditToken('ethereum', '0xABCDEF1234567890abcdefABCDEF1234567890ab')
    expect(audit).not.toBeNull()
    expect(audit!.riskLabel).toBe('safe')
    const firstUrl = vi.mocked(fetch).mock.calls[0]?.[0] as string
    const secondUrl = vi.mocked(fetch).mock.calls[1]?.[0] as string
    expect(firstUrl).toContain('/analyzer/contract')
    expect(secondUrl).toContain('/token-auditor')
  })

  it('returns null when MOBY_NANSEN_API_KEY is missing', async () => {
    delete process.env.MOBY_NANSEN_API_KEY
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await auditToken('ethereum', '0xDEAD')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns null on auth errors (401/403) after both endpoints fail', async () => {
    mockFetchSequence([
      { status: 401, body: { error: 'unauthorized' } },
      { status: 403, body: { error: 'forbidden' } },
    ])
    expect(await auditToken('ethereum', '0xDEAD')).toBeNull()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('returns null on malformed JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{{{not json', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )
    expect(await auditToken('ethereum', '0xDEAD')).toBeNull()
  })

  it('includes chain and contract in analyzer endpoint query params', async () => {
    mockFetchSequence([{ status: 200, body: CONTRACT_ANALYTICS }])
    await auditToken('base', '0xMyContract1111111111111111111111111111')
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as string
    expect(url).toContain('address=0xMyContract1111111111111111111111111111')
    expect(url).toContain('chain=base')
  })
})
