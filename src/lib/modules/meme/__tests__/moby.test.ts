// ─────────────────────────────────────────────────────────────
// Moby adapter unit tests (fixture-backed, no network).
// Shapes mirrored from live web-api.mobyscreener.com/web/api_v2
// probes 2026-09-15 (ORE token, solana leaderboard).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { discoverMobyTokens, auditMobyToken } from '../moby'

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
  process.env.MOBY_API_KEY = 'test-privy-jwt'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const LB_ENTRY = {
  network: 'solana',
  token_address: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
  token_symbol: 'ORE',
  token_created: '2024-08-01T05:17:28',
  token_decimals: 11,
  is_new: false,
  safety_tier: 'green',
  price_usd: 62.11,
  market_cap_usd: 30536577,
  liquidity_usd: 243522,
  price_change_percent: { h24: 1.26 },
  volume_usd: { h24: 458000 },
}

const DETAILS = {
  details: {
    address: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
    symbol: 'ORE',
    name: 'ORE',
    safety_tier: 'green',
    holders: 32164,
    liquidity: 243508,
  },
}

const HOLDERS = {
  holders: [
    { address: 'H1', amount: 116473, percent: 23.6931, value_usd: 7226169 },
    { address: 'H2', amount: 41085, percent: 8.3577, value_usd: 2549010 },
  ],
  total_holders: 32164,
}

describe('discoverMobyTokens', () => {
  it('normalizes leaderboard entries across networks', async () => {
    mockFetchSequence([
      { status: 200, body: { entries: [LB_ENTRY] } },
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [] } },
    ])
    const tokens = await discoverMobyTokens(25)
    expect(tokens).toHaveLength(1)
    const t = tokens[0]
    expect(t.platform).toBe('moby')
    expect(t.chain).toBe('solana')
    expect(t.contract).toBe('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp')
    expect(t.symbol).toBe('ORE')
    expect(t.price).toBeCloseTo(62.11)
    expect(t.change24h).toBeCloseTo(0.0126)
    expect(t.marketCap).toBe(30536577)
    expect(t.liquidity).toBe(243522)
    expect(t.riskLevel).toBe(0) // green
    expect(t.audited).toBe(false)
  })

  it('throws descriptive error without MOBY_API_KEY', async () => {
    delete process.env.MOBY_API_KEY
    await expect(discoverMobyTokens()).rejects.toThrow('MOBY_API_KEY')
  })

  it('throws expired error for an expired JWT before hitting upstream', async () => {
    const exp = Math.floor(Date.now() / 1000) - 10
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
    process.env.MOBY_API_KEY = `h.${payload}.sig`
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    await expect(discoverMobyTokens()).rejects.toThrow('MOBY_API_KEY expired')
    expect(spy).not.toHaveBeenCalled()
  })

  it('passes through a valid unexpired JWT', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
    process.env.MOBY_API_KEY = `h.${payload}.sig`
    mockFetchSequence([
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [] } },
    ])
    const seen = await vi.waitFor(async () => {
      const t = await discoverMobyTokens(1)
      return t
    })
    expect(seen).toEqual([])
    const auth = (vi.mocked(fetch).mock.calls[0]?.[1] as { headers: Record<string, string> }).headers.authorization
    expect(auth).toBe(`Bearer h.${payload}.sig`)
  })

  it('skips entries without contract address', async () => {
    mockFetchSequence([
      { status: 200, body: { entries: [{ network: 'solana' }] } },
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [] } },
    ])
    expect(await discoverMobyTokens(25)).toHaveLength(0)
  })
})

describe('auditMobyToken', () => {
  it('maps green safety tier to riskLevel 0 with holder concentration', async () => {
    mockFetchSequence([
      { status: 200, body: DETAILS },
      { status: 200, body: HOLDERS },
    ])
    const audit = await auditMobyToken('solana', 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp')
    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('moby')
    expect(audit!.riskLevel).toBe(0)
    expect(audit!.riskLabel).toBe('safe')
    expect(audit!.symbol).toBe('ORE')
    expect(audit!.top10HolderPercent).toBeCloseTo(0.3205, 3) // 23.69+8.35 → /100
    expect(audit!.lpLockedPercent).toBe(-1)
  })

  it('returns null on upstream failure', async () => {
    mockFetchSequence([
      { status: 500, body: {} },
      { status: 500, body: {} },
    ])
    expect(await auditMobyToken('solana', 'addr')).toBeNull()
  })

  it('maps red tier to high risk', async () => {
    mockFetchSequence([
      { status: 200, body: { details: { ...DETAILS.details, safety_tier: 'red', symbol: 'RUG', name: 'Rug' } } },
      { status: 200, body: { holders: [], total_holders: 5 } },
    ])
    const audit = await auditMobyToken('solana', 'addr')
    expect(audit!.riskLevel).toBe(3)
    expect(audit!.riskLabel).toBe('high')
  })
})
