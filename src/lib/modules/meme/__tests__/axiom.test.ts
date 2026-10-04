// ─────────────────────────────────────────────────────────────
// Axiom adapter unit tests (fixture-backed, no network).
// Shapes mirrored from api.axiom.xyz/v1 endpoints.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { discoverTokens, auditToken } from '../axiom'

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
  // Use fake test API key - never real credentials
  process.env.AXIOM_API_KEY = 'test-axiom-api-key-fake'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Fixtures ───────────────────────────────────────────────────────────────────

const DISCOVERY_FIXTURE = {
  tokens: [
    {
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
      chain: 'ethereum',
      symbol: 'PEPE',
      name: 'Pepe',
      riskScore: 23,
      createdAt: '2023-04-15T10:30:00Z',
    },
    {
      address: 'DezXAZ8z7PnrnRJjz3wX4RyrKqcCkLtAhM3JWhryrN2',
      chain: 'solana',
      symbol: 'WIF',
      name: 'dogwifhat',
      riskScore: 45,
      createdAt: '2023-11-20T14:22:00Z',
    },
    {
      address: '0x8888888888888888888888888888888888888888',
      chain: 'bsc',
      symbol: 'SHIB',
      name: 'Shiba Inu',
      riskScore: 80,
      createdAt: '2021-08-08T09:15:00Z',
    },
  ],
  meta: { total: 3, updatedAt: new Date().toISOString() },
}

const RISK_AUDIT_FIXTURE = {
  contract: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  chain: 'ethereum',
  riskScore: 23,
  overallRating: 'low-risk',
  canFreeze: false,
  canMint: false,
  isHoneypot: false,
  buyTax: 0,
  sellTax: 2,
  topHolderConcentration: 0.35,
  lpLocked: true,
  lpLockPercent: 85,
  warnings: [{ code: 'LOW_LIQUIDITY', severity: 'warning', message: 'Liquidity below threshold' }],
}

const RISK_HIGH_FIXTURE = {
  contract: '0xBadToken123456789',
  chain: 'ethereum',
  riskScore: 87,
  overallRating: 'high-risk',
  canFreeze: true,
  canMint: true,
  isHoneypot: true,
  buyTax: 5,
  sellTax: 99,
  topHolderConcentration: 0.85,
  lpLocked: false,
  lpLockPercent: 0,
  warnings: [
    { code: 'HONEYPOT', severity: 'critical', message: 'Potential honeypot detected' },
    { code: 'MINT_AUTHORITY', severity: 'critical', message: 'Mint authority active' },
  ],
}

describe('discoverTokens', () => {
  it('normalizes discovery entries to MemeAlphaToken[]', async () => {
    mockFetchSequence([
      { status: 200, body: DISCOVERY_FIXTURE },
    ])
    const tokens = await discoverTokens()
    expect(tokens).toHaveLength(3)

    const t1 = tokens[0]
    expect(t1.platform).toBe('axiom')
    expect(t1.chain).toBe('ethereum')
    expect(t1.contract).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1')
    expect(t1.symbol).toBe('PEPE')
    expect(t1.name).toBe('Pepe')
    expect(t1.riskLevel).toBe(0) // score 23 < 25 → level 0
    expect(t1.audited).toBe(false)

    const t2 = tokens[1]
    expect(t2.chain).toBe('solana')
    expect(t2.symbol).toBe('WIF')
    expect(t2.riskLevel).toBe(1) // score 45 in [25,50) → level 1

    const t3 = tokens[2]
    expect(t3.chain).toBe('bsc')
    expect(t3.symbol).toBe('SHIB')
    expect(t3.riskLevel).toBe(3) // score 80 >= 75 → level 3
  })

  it('respects limit param', async () => {
    mockFetchSequence([{ status: 200, body: DISCOVERY_FIXTURE }])
    const spy = vi.fn().mockResolvedValue(DISCOVERY_FIXTURE)
    vi.stubGlobal('fetch', spy)

    await discoverTokens(2)

    expect(spy).toHaveBeenCalled()
    const calls = spy.mock.calls
    const lastCall = calls[calls.length - 1]
    const url = lastCall[0] as string
    expect(url).toContain('/tokens/risk/list')
    expect(url).toContain('limit=2')
  })

  it('filters invalid entries by validation', async () => {
    const partialFixture = {
      tokens: [
        { address: '0xValid123', chain: 'eth', symbol: 'OK' },
        { chain: 'eth', symbol: 'NoAddr' }, // missing address
        { address: '0xAlsoValid', chain: 'base', symbol: 'BASE' },
      ],
      meta: { total: 3, updatedAt: new Date().toISOString() },
    }
    mockFetchSequence([{ status: 200, body: partialFixture }])
    const tokens = await discoverTokens()
    expect(tokens).toHaveLength(2)
    expect(tokens[0].contract).toBe('0xValid123')
    expect(tokens[1].contract).toBe('0xAlsoValid')
  })

  it('returns empty array when API has no tokens', async () => {
    mockFetchSequence([
      { status: 200, body: { tokens: [], meta: { total: 0, updatedAt: new Date().toISOString() } } },
    ])
    const tokens = await discoverTokens()
    expect(tokens).toEqual([])
  })

  it('handles malformed JSON response gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('not json at all', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      }),
    )
    const tokens = await discoverTokens()
    expect(tokens).toEqual([])
  })

  it('returns empty array on non-200 status', async () => {
    mockFetchSequence([{ status: 500, body: { error: 'Internal server error' } }])
    const tokens = await discoverTokens()
    expect(tokens).toEqual([])
  })

  it('skips duplicate contracts by chain+address id', async () => {
    const duplicates = {
      tokens: [
        { address: '0xSame', chain: 'eth', symbol: 'A' },
        { address: '0xSame', chain: 'eth', symbol: 'B' },
        { address: '0xDiff', chain: 'eth', symbol: 'C' },
      ],
      meta: { total: 3, updatedAt: new Date().toISOString() },
    }
    mockFetchSequence([{ status: 200, body: duplicates }])
    const tokens = await discoverTokens()
    expect(tokens).toHaveLength(2)
    expect(tokens.map((t) => t.id)).toEqual(['eth:0xSame', 'eth:0xDiff'])
  })

  it('sets correct risk labels based on score levels', async () => {
    const mixedScores = {
      tokens: [
        { address: '0xLow', chain: 'eth', symbol: 'SAFE', riskScore: 10 },
        { address: '0xMid', chain: 'eth', symbol: 'MED', riskScore: 60 },
        { address: '0xHigh', chain: 'eth', symbol: 'DANGER', riskScore: 90 },
      ],
      meta: { total: 3, updatedAt: new Date().toISOString() },
    }
    mockFetchSequence([{ status: 200, body: mixedScores }])
    const tokens = await discoverTokens()
    expect(tokens[0].riskLevel).toBe(0) // < 25
    expect(tokens[1].riskLevel).toBe(2) // 50-75
    expect(tokens[2].riskLevel).toBe(3) // >= 75
  })
})

describe('auditToken', () => {
  it('maps successful audit with low risk score', async () => {
    mockFetchSequence([
      { status: 200, body: RISK_AUDIT_FIXTURE },
    ])
    const audit = await auditToken('ethereum', '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1')
    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('axiom')
    expect(audit!.chain).toBe('ethereum')
    expect(audit!.contract).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1')
    expect(audit!.riskLevel).toBe(0) // score 23 < 25
    expect(audit!.riskLabel).toBe('low')
    expect(audit!.buyTax).toBeCloseTo(0, 4)
    expect(audit!.sellTax).toBeCloseTo(0.02, 4)
    expect(audit!.top10HolderPercent).toBeCloseTo(0.0035, 4) // /100
    expect(audit!.lpLockedPercent).toBeCloseTo(0.85, 4)
    expect(audit!.canFreeze).toBe(false)
    expect(audit!.canMint).toBe(false)
    expect(audit!.auditedAt).toBeDefined()
  })

  it('returns null when contract not found (all retries fail)', async () => {
    mockFetchSequence([
      { status: 404, body: { error: 'Contract not found' } },
    ])
    const audit = await auditToken('ethereum', '0xNonExistentContract123')
    expect(audit).toBeNull()
  })

  it('falls back to alternative endpoint on first failure', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (callCount++ === 0) {
          return new Response('{"error": "first"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify(RISK_AUDIT_FIXTURE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    const audit = await auditToken('ethereum', '0xFallbackTest')
    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('axiom')
  })

  it('handles high risk token with critical warnings', async () => {
    mockFetchSequence([
      { status: 200, body: RISK_HIGH_FIXTURE },
    ])
    const audit = await auditToken('ethereum', '0xBadToken123456789')
    expect(audit).not.toBeNull()
    expect(audit!.riskLevel).toBe(3) // score 87 >= 75
    expect(audit!.riskLabel).toBe('high')
    expect(audit!.isHoneypot).toBe(true)
    expect(audit!.canFreeze).toBe(true)
    expect(audit!.canMint).toBe(true)
    expect(audit!.lpLockedPercent).toBe(-1)
  })

  it('succeeds on retry after initial 500 errors', async () => {
    let attempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (++attempt <= 4) {
          return new Response(
            JSON.stringify({ error: `Server error attempt ${attempt}` }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify(RISK_AUDIT_FIXTURE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    const audit = await auditToken('ethereum', '0xRetrySuccess')
    expect(audit).not.toBeNull()
    expect(attempt).toBe(5) // succeeded on 5th attempt
  })

  it('returns null after 5 consecutive failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: 'Persistent failure' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )
    expect(await auditToken('ethereum', '0xFailForever')).toBeNull()
  })

  it('includes Bearer auth header when AXIOM_API_KEY is set', async () => {
    const capturedInit: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        capturedInit.push(init || {})
        return new Response(JSON.stringify(RISK_AUDIT_FIXTURE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    await auditToken('ethereum', '0xAUTHCheck')
    expect(capturedInit.length).toBeGreaterThan(0)
    const headers = capturedInit[0].headers as Record<string, string>
    expect(headers.authorization).toContain('Bearer')
    expect(headers.authorization).toBe('Bearer test-axiom-api-key-fake')
  })

  it('validates response structure and returns null for malformed data', async () => {
    const invalid = { someRandomField: 'value' }
    mockFetchSequence([{ status: 200, body: invalid }])
    const audit = await auditToken('ethereum', '0xInvalidResponse')
    expect(audit).toBeNull()
  })

  it('handles LP locked vs unlocked correctly', async () => {
    const unlockedFixture = { ...RISK_AUDIT_FIXTURE, lpLocked: false, lpLockPercent: 0 }
    mockFetchSequence([{ status: 200, body: unlockedFixture }])
    const audit = await auditToken('ethereum', '0xUnlockedLP')
    expect(audit).not.toBeNull()
    expect(audit!.lpLockedPercent).toBe(-1)
  })
})
