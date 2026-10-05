// ─────────────────────────────────────────────────────────────
// GMGN.ai adapter unit tests (fixture-backed, no network).
// Shapes mirrored from gmgn.ai/defi/quotation/v1 endpoints.
// Covers: discoverGmgnTokens, auditGmgnToken, Cloudflare 403, retry logic.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  discoverGmgnTokens,
  auditGmgnToken,
  __resetGmgnRateLimiterForTests,
} from '../gmgn'

// Helper to mock fetch with a sequence of responses
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
  // Ensure clean state - no real session cookie
  delete process.env.GMGN_SESSION_COOKIE
  // Reset rate limiter state before each test
  __resetGmgnRateLimiterForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── FIXTURES ──

const SOL_TRENDING_FIXTURE = {
  data: {
    list: [
      {
        tokenInfo: {
          address: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          name: 'Solana',
          chain: 'sol',
          priceUsd: 145.32,
          priceChange24h: 2.45,
          volume24h: 458000000,
          marketCap: 68500000000,
          liquidity: 125000000,
          holders: 250000,
          createdAt: 1600000000000,
        },
        trendScore: 95,
      },
      {
        tokenInfo: {
          address: '7xKXtg2CW87d97TXJSDbgBNTbxFcwEZsYn5QzZ4Vm1Tq',
          symbol: 'BONK',
          name: 'Bonk',
          chain: 'sol',
          priceUsd: 0.00002341,
          priceChange24h: 12.56,
          volume24h: 85000000,
          marketCap: 1800000000,
          liquidity: 4500000,
          holders: 120000,
          createdAt: 1670000000000,
        },
        trendScore: 88,
      },
    ],
  },
}

const ETH_TRENDING_FIXTURE = {
  data: {
    list: [
      {
        tokenInfo: {
          address: '0xc02aaa39bb223ef0e3132a7cd543eadcf1f9f65c',
          symbol: 'WETH',
          name: 'Wrapped Ether',
          chain: 'eth',
          priceUsd: 2450.67,
          priceChange24h: 1.23,
          volume24h: 850000000,
          marketCap: 295000000000,
          liquidity: 980000000,
          holders: 520000,
          createdAt: 1500000000000,
        },
        trendScore: 98,
      },
    ],
  },
}

const BASE_TRENDING_FIXTURE = {
  data: {
    list: [
      {
        tokenInfo: {
          address: '0x4200000000000000000000000000000000000006',
          symbol: 'OP',
          name: 'Optimism',
          chain: 'base',
          priceUsd: 2.34,
          priceChange24h: 5.67,
          volume24h: 45000000,
          marketCap: 2100000000,
          liquidity: 35000000,
          holders: 180000,
          createdAt: 1660000000000,
        },
        trendScore: 85,
      },
    ],
  },
}

const AUDIT_SUCCESS_FIXTURE = {
  data: {
    basicInfo: {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      chain: 'sol',
      isHoneypot: false,
      isMintable: false,
      freezeAuthorityAddress: null,
    },
    assetInfo: {
      buyTax: 0,
      sellTax: 0,
      liquidity: 125000000,
      holderCount: 250000,
    },
    topHolderList: [
      { address: 'Addr1', percent: 5.2 },
      { address: 'Addr2', percent: 3.8 },
      { address: 'Addr3', percent: 2.1 },
      { address: 'Addr4', percent: 1.9 },
      { address: 'Addr5', percent: 1.5 },
      { address: 'Addr6', percent: 1.2 },
      { address: 'Addr7', percent: 1.0 },
      { address: 'Addr8', percent: 0.9 },
      { address: 'Addr9', percent: 0.8 },
      { address: 'Addr10', percent: 0.7 },
    ],
  },
}

const AUDIT_HONEYPOT_FIXTURE = {
  data: {
    basicInfo: {
      address: '0xRUGGED123456789012345678901234567890ab',
      symbol: 'RUG',
      name: 'RugPull Token',
      chain: 'eth',
      isHoneypot: true,
      isMintable: true,
      freezeAuthorityAddress: '0xFreeze123456789012345678901234567890ab',
    },
    assetInfo: {
      buyTax: 99,
      sellTax: 99,
      liquidity: 50000,
      holderCount: 1200,
    },
    topHolderList: [
      { address: 'Dev1', percent: 45.5 },
      { address: 'Dev2', percent: 35.2 },
    ],
  },
}

const AUDIT_HEAVY_TAX_FIXTURE = {
  data: {
    basicInfo: {
      address: '0xTAXY1234567890123456789012345678901234ab',
      symbol: 'TAXY',
      name: 'Heavy Tax Token',
      chain: 'eth',
      isHoneypot: false,
      isMintable: false,
      freezeAuthorityAddress: null,
    },
    assetInfo: {
      buyTax: 15,
      sellTax: 20,
      liquidity: 150000,
      holderCount: 8500,
    },
    topHolderList: [],
  },
}

const AUDIT_NO_DATA_FIXTURE = {
  data: null,
}

describe('discoverGmgnTokens', () => {
  it('discovers tokens on Solana chain and normalizes to MemeAlphaToken[]', async () => {
    mockFetchSequence([
      { status: 200, body: SOL_TRENDING_FIXTURE },
      { status: 200, body: ETH_TRENDING_FIXTURE },
      { status: 200, body: BASE_TRENDING_FIXTURE },
    ])

    const tokens = await discoverGmgnTokens(20)

    expect(tokens).toBeInstanceOf(Array)
    expect(tokens.length).toBeGreaterThanOrEqual(2)

    const solToken = tokens.find((t) => t.contract.toLowerCase() === 'so11111111111111111111111111111111111111112')
    expect(solToken).toBeDefined()
    if (solToken) {
      expect(solToken.platform).toBe('gmgn')
      expect(solToken.chain).toBe('solana')
      expect(solToken.symbol).toBe('SOL')
      expect(solToken.name).toBe('Solana')
      expect(solToken.price).toBeCloseTo(145.32)
      expect(solToken.change24h).toBeCloseTo(2.45)
      expect(solToken.volume24h).toBe(458000000)
      expect(solToken.marketCap).toBe(68500000000)
      expect(solToken.liquidity).toBe(125000000)
      expect(solToken.holders).toBe(250000)
      expect(solToken.createdAt).toBe(1600000000000)
      expect(solToken.riskLevel).toBe(1)
      expect(solToken.audited).toBe(false)
      expect(solToken.provenance).toEqual({
        sourceType: 'public-api',
        provider: 'gmgn',
        experimental: true,
        note: 'GMGN public rank endpoint; discovery feed, not a security audit',
      })
      expect(solToken.riskKnown).toBe(false)
    }
  })

  it('discovers tokens across multiple chains (sol, eth, base)', async () => {
    mockFetchSequence([
      { status: 200, body: SOL_TRENDING_FIXTURE },
      { status: 200, body: ETH_TRENDING_FIXTURE },
      { status: 200, body: BASE_TRENDING_FIXTURE },
    ])

    const tokens = await discoverGmgnTokens(20)

    const solChains = tokens.filter((t) => t.chain === 'solana')
    const ethChains = tokens.filter((t) => t.chain === 'ethereum')
    const baseChains = tokens.filter((t) => t.chain === 'base')

    expect(solChains.length).toBeGreaterThan(0)
    expect(ethChains.length).toBeGreaterThan(0)
    expect(baseChains.length).toBeGreaterThan(0)
  })

  it('respects limitPerChain parameter', async () => {
    const largeFixture = {
      data: {
        list: Array.from({ length: 50 }, (_, i) => ({
          tokenInfo: {
            address: `0x${i.toString().padStart(40, '0')}`,
            symbol: `TKN${i}`,
            name: `Token ${i}`,
            chain: 'sol',
            priceUsd: i * 0.01,
            priceChange24h: Math.random() * 100,
            volume24h: Math.random() * 1000000,
            marketCap: Math.random() * 100000000,
            liquidity: Math.random() * 1000000,
            holders: Math.floor(Math.random() * 10000),
            createdAt: Date.now() - i * 1000000000,
          },
          trendScore: 50 + i,
        })),
      },
    }

    mockFetchSequence([
      { status: 200, body: largeFixture },
      { status: 200, body: { data: { list: [] } } },
      { status: 200, body: { data: { list: [] } } },
    ])

    const tokens = await discoverGmgnTokens(5)

    expect(tokens).toHaveLength(5)
  })

  it('filters out entries without contract address', async () => {
    const invalidFixture = {
      data: {
        list: [
          {
            tokenInfo: {
              symbol: 'INVALID',
              name: 'No Address Token',
              chain: 'sol',
              priceUsd: 0.01,
            },
            trendScore: 10,
          },
          {
            tokenInfo: {
              address: '',
              symbol: 'EMPTY',
              name: 'Empty Address',
              chain: 'sol',
              priceUsd: 0.02,
            },
            trendScore: 20,
          },
          {
            tokenInfo: {
              address: 'ValidAddress12345678901234567890123456789012',
              symbol: 'VALID',
              name: 'Valid Token',
              chain: 'sol',
              priceUsd: 0.03,
            },
            trendScore: 30,
          },
        ],
      },
    }

    mockFetchSequence([
      { status: 200, body: invalidFixture },
      { status: 200, body: { data: { list: [] } } },
      { status: 200, body: { data: { list: [] } } },
    ])

    const tokens = await discoverGmgnTokens(20)

    expect(tokens).toHaveLength(1)
    expect(tokens[0].symbol).toBe('VALID')
  })

  it('sorts results by market cap descending', async () => {
    const fixture = {
      data: {
        list: [
          {
            tokenInfo: {
              address: '0xSmall123456789012345678901234567890123456',
              symbol: 'SMALL',
              name: 'Small Cap',
              chain: 'sol',
              priceUsd: 0.001,
              marketCap: 100000,
            },
          },
          {
            tokenInfo: {
              address: '0xBig123456789012345678901234567890123456789012',
              symbol: 'BIG',
              name: 'Big Cap',
              chain: 'sol',
              priceUsd: 10,
              marketCap: 50000000,
            },
          },
        ],
      },
    }

    mockFetchSequence([
      { status: 200, body: fixture },
      { status: 200, body: { data: { list: [] } } },
      { status: 200, body: { data: { list: [] } } },
    ])

    const tokens = await discoverGmgnTokens(20)

    expect(tokens[0].marketCap).toBeGreaterThan(tokens[1].marketCap)
  })

  it('degrades gracefully on Cloudflare 403 challenge after 5 attempts', async () => {
    // Every request hits the Cloudflare challenge — no real network involved.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { msg: 'Cloudflare challenge' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    vi.useFakeTimers()
    const run = discoverGmgnTokens().then((tokens) => {
      vi.useRealTimers()
      return tokens
    })
    // Flush microtasks so retryWithBackoff reaches its setTimeout waits.
    // Stop as soon as `run` settles — it restores real timers on completion.
    let settled = false
    run.then(() => (settled = true), () => (settled = true))
    for (let i = 0; i < 20 && !settled; i++) await vi.advanceTimersByTimeAsync(10_000)
    const tokens = await run
    // Module catches per-chain errors and returns [] (graceful degradation)
    expect(tokens).toEqual([])
    // All 25 attempts (5 chains × 5) hit the challenge
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(25)
  })
})

describe('auditGmgnToken', () => {
  it('audits token successfully and returns MemeRiskAudit', async () => {
    mockFetchSequence([
      { status: 200, body: AUDIT_SUCCESS_FIXTURE },
    ])

    const audit = await auditGmgnToken('solana', 'So11111111111111111111111111111111111111112')

    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('gmgn')
    expect(audit!.chain).toBe('solana')
    expect(audit!.contract).toBe('so11111111111111111111111111111111111111112')
    expect(audit!.symbol).toBe('SOL')
    expect(audit!.name).toBe('Solana')
    expect(audit!.riskLevel).toBe(1)
    expect(audit!.riskLabel).toBe('low')
    expect(audit!.buyTax).toBe(0)
    expect(audit!.sellTax).toBe(0)
    expect(audit!.top10HolderPercent).toBeCloseTo(19.1, 2)
    expect(audit!.lpLockedPercent).toBe(-1)
    expect(audit!.canFreeze).toBe(false)
    expect(audit!.canMint).toBe(false)
    expect(audit!.riskCounts).toEqual({ high: 0, middle: 0, low: 1 })
    expect(typeof audit!.auditedAt).toBe('number')
    expect(typeof audit!.auditedAt).toBe('number')
  })

  it('returns null when no security data', async () => {
    mockFetchSequence([
      { status: 200, body: AUDIT_NO_DATA_FIXTURE },
    ])

    const audit = await auditGmgnToken('solana', 'UnknownContract12345678901234567890123456')

    expect(audit).toBeNull()
  })

  it('identifies honeypot tokens as high risk', async () => {
    mockFetchSequence([
      { status: 200, body: AUDIT_HONEYPOT_FIXTURE },
    ])

    const audit = await auditGmgnToken('ethereum', '0xRUGGED123456789012345678901234567890ab')

    expect(audit!.riskLevel).toBe(3)
    expect(audit!.riskLabel).toBe('high')
    expect(audit!.isHoneypot).toBe(true)
    expect(audit!.canFreeze).toBe(true)
  })

  it('identifies heavy tax tokens as medium risk', async () => {
    mockFetchSequence([
      { status: 200, body: AUDIT_HEAVY_TAX_FIXTURE },
    ])

    const audit = await auditGmgnToken('ethereum', '0xTAXY1234567890123456789012345678901234ab')

    expect(audit!.riskLevel).toBe(2)
    expect(audit!.riskLabel).toBe('middle')
    expect(audit!.buyTax).toBeCloseTo(0.15)
    expect(audit!.sellTax).toBeCloseTo(0.20)
  })
})
