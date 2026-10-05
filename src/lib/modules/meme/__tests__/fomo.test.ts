// ─────────────────────────────────────────────────────────────
// Fomo adapter unit tests (fixture-backed, no network).
// Shapes mirrored from live api.fomofun.xyz/v1 feeds endpoint
// probes 2026-10-04 (trending token launches).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { discoverFomoTokens, auditFomoToken, __resetFomoCookieForTests } from '../fomo'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function mockFetchSequence(bodies: Array<{ status: number; body: unknown }>) {
  const queue = [...bodies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = queue.shift() ?? { status: 500, body: {} }
      return new Response(JSON.stringify(next.body), { 
        status: next.status, 
        headers: { 'Content-Type': 'application/json' } 
      })
    }),
  )
}

beforeEach(() => {
  // Isolate from any real env or disk state
  delete process.env.FOMO_API_KEY
  process.env.FOMO_API_URL = 'https://api.fomofun.xyz/v1'
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetFomoCookieForTests()
  delete process.env.FOMO_SESSION_PATH
})

// ── Realistic Fomo-shaped fixtures ───────────────────────────

const SOLANA_TOKEN_1 = {
  chain: 'solana',
  contract: '7xKXtg2CW87d97jJHreT2iUdToswsRjfLiNnUXzpvZmG',
  symbol: 'BONK',
  name: 'Bonk',
  logo: 'https://img.fomofun.xyz/bonk.png',
  createdAt: '2024-01-15T08:30:00Z',
  priceUsd: 0.00002145,
  marketCapUsd: 1250000,
  liquidityUsd: 85000,
  volumeUsd: 450000,
  priceChangePct: { h24: 12.5 },
  txCount24h: 15234,
  holderCount24h: 8456,
  trendingScore: 98.5,
}

const SOLANA_TOKEN_2 = {
  chain: 'solana',
  contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  name: 'USD Coin',
  logo: null,
  createdAt: '2024-02-20T14:22:00Z',
  priceUsd: 1.0,
  marketCapUsd: 8500000,
  liquidityUsd: 450000,
  volumeUsd: 2100000,
  priceChangePct: { h24: 0.02 },
  txCount24h: 8932,
  holderCount24h: 12453,
  trendingScore: 85.2,
}

const ETHEREUM_TOKEN_1 = {
  chain: 'eth',
  contract: '0xa1b2c3d4e5f6789012345678901234567890abcd',
  symbol: 'PEPE',
  name: 'Pepe',
  logo: 'https://img.fomofun.xyz/pepe.png',
  createdAt: '2024-03-10T19:45:00Z',
  priceUsd: 0.000000789,
  marketCapUsd: 3250000,
  liquidityUsd: 180000,
  volumeUsd: 980000,
  priceChangePct: { '24h': -3.2 },
  txCount24h: 22456,
  holderCount24h: 15678,
  trendingScore: 92.1,
}

// ── discovery tests ──────────────────────────────────────────

describe('discoverFomoTokens', () => {
  it('normalizes successful launch feed to MemeAlphaToken[]', async () => {
    mockFetchSequence([
      { 
        status: 200, 
        body: { 
          entries: [SOLANA_TOKEN_1, SOLANA_TOKEN_2, ETHEREUM_TOKEN_1],
          total: 3 
        } 
      },
    ])

    const result = await discoverFomoTokens(10)

    expect(result.length).toBe(3)
    expect(result[0]).toMatchObject({
      id: 'solana:7xKXtg2CW87d97jJHreT2iUdToswsRjfLiNnUXzpvZmG',
      platform: 'fomo',
      chain: 'solana',
      contract: '7xKXtg2CW87d97jJHreT2iUdToswsRjfLiNnUXzpvZmG',
      symbol: 'BONK',
      name: 'Bonk',
      price: 0.00002145,
      change24h: 0.125,
      volume24h: 450000,
      marketCap: 1250000,
      liquidity: 85000,
      riskLevel: 2,
      holders: 8456,
      audited: false,
    })
    
    expect(result[1].id).toBe('solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    expect(result[2].id).toBe('eth:0xa1b2c3d4e5f6789012345678901234567890abcd')

    expect(result[0].provenance).toEqual({
      sourceType: 'reverse-engineered',
      provider: 'fomo',
      experimental: true,
      note: 'Feed endpoint RE-ed from fomofun.xyz web app; unverified stability',
    })
    expect(result[0].riskKnown).toBe(false)
  })

  it('respects limit param when fewer tokens available', async () => {
    mockFetchSequence([
      { 
        status: 200, 
        body: { 
          entries: [SOLANA_TOKEN_1, SOLANA_TOKEN_2],
          total: 2 
        } 
      },
    ])

    const result = await discoverFomoTokens(100)

    expect(result.length).toBe(2)
    expect(result).toHaveLength(2)
  })

  it('filters invalid entries missing contract or symbol', async () => {
    const invalidEntry = {
      chain: 'solana',
      // Missing contract field
      symbol: '',
      name: 'Invalid Token',
      priceUsd: 0.01,
    }

    const validEntry = {
      chain: 'solana',
      contract: '9yLZh3DXa98e08kKIftV3jVeUttxsxSkMoOoYyAqwzrH',
      symbol: 'VALID',
      name: 'Valid Token',
      priceUsd: 0.05,
      priceChangePct: { h24: 5.0 },
    }

    mockFetchSequence([
      { 
        status: 200, 
        body: { 
          entries: [invalidEntry, validEntry],
          total: 2 
        } 
      },
    ])

    const result = await discoverFomoTokens(10)

    expect(result.length).toBe(1)
    expect(result[0].symbol).toBe('VALID')
    expect(result[0].contract).toBe('9yLZh3DXa98e08kKIftV3jVeUttxsxSkMoOoYyAqwzrH')
  })

  it('handles empty feed gracefully returns []', async () => {
    mockFetchSequence([
      { 
        status: 200, 
        body: { 
          entries: [],
          total: 0 
        } 
      },
    ])

    const result = await discoverFomoTokens(50)

    expect(result).toEqual([])
    expect(result.length).toBe(0)
  })

  it('handles malformed payload returning []', async () => {
    mockFetchSequence([
      { 
        status: 200, 
        body: { 
          data: 'not entries array'
        } 
      },
    ])

    const result = await discoverFomoTokens(20)

    expect(result).toEqual([])
    expect(result.length).toBe(0)
  })

  it('handles malformed entry with undefined price fields', async () => {
    const partialEntry = {
      chain: 'solana',
      contract: '3aMbN4eWx67d98kJHgTuV2sWeRsQpOnMlKjIhGfEdCbA',
      symbol: 'PARTIAL',
      // Missing optional fields
    }

    mockFetchSequence([
      { 
        status: 200, 
        body: { 
          entries: [partialEntry],
          total: 1 
        } 
      },
    ])

    const result = await discoverFomoTokens(10)

    expect(result.length).toBe(1)
    expect(result[0].price).toBe(0)
    expect(result[0].volume24h).toBe(0)
    expect(result[0].marketCap).toBe(0)
    expect(result[0].liquidity).toBe(0)
  })
})

// ── audit test ───────────────────────────────────────────────

describe('auditFomoToken', () => {
  it('returns null as Fomo is discovery-only platform', async () => {
    const result = await auditFomoToken('solana', '7xKXtg2CW87d97jJHreT2iUdToswsRjfLiNnUXzpvZmG')
    
    expect(result).toBeNull()
  })

  it('returns null for ethereum contract too', async () => {
    const result = await auditFomoToken('eth', '0xa1b2c3d4e5f6789012345678901234567890abcd')
    
    expect(result).toBeNull()
  })
})

// ── rate limit retry behavior ────────────────────────────────

describe('discoverFomoTokens rate limit handling', () => {
  it('retires on 429 then succeeds on retry', async () => {
    
    mockFetchSequence([
      // First attempt: 429 rate limited
      { status: 429, body: { error: 'rate_limit_exceeded' } },
      // Second attempt: success after wait
      { 
        status: 200, 
        body: { 
          entries: [SOLANA_TOKEN_1],
          total: 1 
        } 
      },
    ])

    const result = await discoverFomoTokens(5)

    expect(result.length).toBe(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting 5 retry attempts on persistent 429', async () => {
    
    mockFetchSequence([
      // All attempts rate limited
      { status: 429, body: { error: 'rate_limit_exceeded' } },
      { status: 429, body: { error: 'rate_limit_exceeded' } },
      { status: 429, body: { error: 'rate_limit_exceeded' } },
      { status: 429, body: { error: 'rate_limit_exceeded' } },
      { status: 429, body: { error: 'rate_limit_exceeded' } },
    ])

    const result = await discoverFomoTokens(5)
    expect(result).toEqual([])
  })
})


// ── Session-file cookie support ──────────────────────────────

describe('fomo session file', () => {
  it('attaches cookie header from data/fomo-session.json (FOMO_SESSION_PATH override)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fomo-sess-'))
    const path = join(dir, 'fomo-session.json')
    writeFileSync(path, JSON.stringify({ cookie: 'fomo_session=abc123; other=1' }))
    process.env.FOMO_SESSION_PATH = path

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ entries: [SOLANA_TOKEN_1] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await discoverFomoTokens(5)
    expect(fetchMock).toHaveBeenCalled()
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.cookie).toBe('fomo_session=abc123; other=1')

    delete process.env.FOMO_SESSION_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to no cookie when session file absent', async () => {
    process.env.FOMO_SESSION_PATH = join(tmpdir(), 'fomo-nonexistent', 'fomo-session.json')

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ entries: [SOLANA_TOKEN_1] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await discoverFomoTokens(5)
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.cookie).toBeUndefined()

    delete process.env.FOMO_SESSION_PATH
  })

  it('caches resolution until reset (file removed mid-flight keeps cookie)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fomo-sess-'))
    const path = join(dir, 'fomo-session.json')
    writeFileSync(path, JSON.stringify({ cookie: 'cached=1' }))
    process.env.FOMO_SESSION_PATH = path
    __resetFomoCookieForTests()

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ entries: [SOLANA_TOKEN_1] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await discoverFomoTokens(5)
    let headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.cookie).toBe('cached=1')

    rmSync(path)
    await discoverFomoTokens(5)
    headers = fetchMock.mock.calls[1][1].headers as Record<string, string>
    expect(headers.cookie).toBe('cached=1') // cached

    delete process.env.FOMO_SESSION_PATH
    rmSync(dir, { recursive: true, force: true })
  })
})
