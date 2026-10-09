// ─────────────────────────────────────────────────────────────
// GMGN.ai adapter unit tests (fixture-backed, no network).
// Shapes mirrored from gmgn.ai/defi/quotation/v1 endpoints.
// Covers: discoverGmgnTokens, auditGmgnToken, Cloudflare 403, retry logic.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  discoverGmgnTokens,
  auditGmgnToken,
  __resetGmgnRateLimiterForTests,
  __resetGmgnCookieForTests,
  __gmgnSessionCookieForTests,
  __setGmgnCurlForTests,
} from '../gmgn'

// Helper to mock the curl-child seam with a sequence of responses.
function mockFetchSequence(bodies: Array<{ status: number; body: unknown }>) {
  const queue = [...bodies]
  __setGmgnCurlForTests(() => {
    const next = queue.shift() ?? { status: 500, body: {} }
    return `${JSON.stringify(next.body)}\nCURL_STATUS:${next.status}`
  })
}


beforeEach(() => {
  // Ensure clean state - no real session cookie
  delete process.env.GMGN_SESSION_COOKIE
  // Reset rate limiter state before each test
  __resetGmgnRateLimiterForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetGmgnCookieForTests()
  __setGmgnCurlForTests(null)
  delete process.env.GMGN_SESSION_PATH
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
  code: 0,
  msg: 'success',
  data: {
    holders: {
      chain: 'sol',
      holder_count: 70,
      top70_sniper_hold_rate: '0.0125',
      statusNow: {
        hold: 5, bought_more: 0, sold_part: 10, sold: 55, transfered: 0,
        bought_rate: '0.9', holding_rate: '0.25',
        top_10_holder_rate: 0.191,
      },
      holderInfo: [
        { status: 'hold', wallet_address: 'W1', tags: ['bluechip_owner'], maker_token_tags: [] },
        { status: 'sold', wallet_address: 'W2', tags: ['sniper'], maker_token_tags: [] },
        { status: 'hold', wallet_address: 'W3', tags: ['fresh_wallet'], maker_token_tags: ['sniper'] },
        { status: 'hold', wallet_address: 'W4', tags: [], maker_token_tags: [] },
        { status: 'hold', wallet_address: 'W5', tags: null, maker_token_tags: null },
        { status: 'hold', wallet_address: 'W6', tags: [], maker_token_tags: [] },
      ],
    },
  },
}

const AUDIT_NO_DATA_FIXTURE = { code: 0, msg: 'success', data: {} }

// /vas/api/v1/token_holders shape (live-proven 2026-10-09).
const HOLDERS_FIXTURE = {
  code: 0,
  message: 'success',
  data: {
    list: [
      // cost 100 → value 200 = +100%
      { address: 'H1', amount_percentage: 0.137, cost_cur: 100, usd_value: 200, is_suspicious: false, tags: ['top_holder'], maker_token_tags: ['top_holder'] },
      // cost 100 → value 150 = +50%
      { address: 'H2', amount_percentage: 0.097, cost_cur: 100, usd_value: 150, is_suspicious: false, tags: [], maker_token_tags: [] },
      // suspicious → insider taint
      { address: 'H3', amount_percentage: 0.049, cost_cur: 100, usd_value: 110, is_suspicious: true, tags: [], maker_token_tags: [] },
      // no cost → excluded from the average
      { address: 'H4', amount_percentage: 0.037, cost_cur: 0, usd_value: 50, is_suspicious: false, tags: [], maker_token_tags: [] },
      { address: 'H5', amount_percentage: 0.034, cost_cur: 100, usd_value: 100, is_suspicious: false, tags: [], maker_token_tags: [] },
    ],
  },
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
    let calls = 0
    __setGmgnCurlForTests(() => {
      calls++
      return `${JSON.stringify({ error: { msg: 'Cloudflare challenge' } })}\nCURL_STATUS:403`
    })
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
    expect(calls).toBe(25)
  })
})

describe('auditGmgnToken (top_buyers contract)', () => {
  it('maps exit ratio, sniper rate, concentration and holder PnL', async () => {
    mockFetchSequence([
      { status: 200, body: AUDIT_SUCCESS_FIXTURE },
      { status: 200, body: HOLDERS_FIXTURE },
    ])

    const audit = await auditGmgnToken('solana', 'So11111111111111111111111111111111111111112')

    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('gmgn')
    expect(audit!.top10HolderPercent).toBeCloseTo(0.191, 3)
    expect(audit!.distribution?.sniperPercent).toBeCloseTo(0.0125, 4)
    // holding_rate 0.25 → 75% of the launch-buyer cohort already exited.
    expect(audit!.distribution?.bundlerSoldPercent).toBeCloseTo(75, 5)
    // Top-5 PnL: +100%, +50%, +10%, (H4 has no cost → excluded), 0% → 40.
    expect(audit!.top5AvgPnlPercent).toBeCloseTo(40, 5)
    // Holders endpoint supplies real percents + is_suspicious taint.
    expect(audit!.topWallets!.map((w) => w.address)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5'])
    expect(audit!.topWallets![0].percent).toBeCloseTo(0.137, 3)
    expect(audit!.topWallets!.map((w) => w.insider)).toEqual([false, false, true, false, false])
    expect(audit!.riskLabel).toBe('low')
  })

  it('falls back to status-list taint and null PnL when holders refuses', async () => {
    mockFetchSequence([
      { status: 200, body: AUDIT_SUCCESS_FIXTURE },
      { status: 500, body: {} }, // holders endpoint down for all retries
    ])

    const audit = await auditGmgnToken('solana', 'So11111111111111111111111111111111111111112')

    expect(audit).not.toBeNull()
    expect(audit!.top5AvgPnlPercent).toBeNull()
    // Fallback path: sold wallets dropped, W3 sniper/fresh → insider.
    expect(audit!.topWallets!.map((w) => w.address)).toEqual(['W1', 'W3', 'W4', 'W5', 'W6'])
    expect(audit!.topWallets!.map((w) => w.insider)).toEqual([false, true, false, false, false])
    // Exit/concentration data survives the PnL leg failing.
    expect(audit!.distribution?.bundlerSoldPercent).toBeCloseTo(75, 5)
  })

  it('returns null when holders data is absent', async () => {
    mockFetchSequence([{ status: 200, body: AUDIT_NO_DATA_FIXTURE }])
    expect(await auditGmgnToken('solana', 'UnknownContract12345678901234567890123456')).toBeNull()
  })

  it('reports concentration risk honestly at high top10 share', async () => {
    mockFetchSequence([{
      status: 200,
      body: {
        code: 0, data: {
          holders: {
            holder_count: 10, top70_sniper_hold_rate: '0',
            statusNow: { holding_rate: '1', top_10_holder_rate: 0.62 },
            holderInfo: [],
          },
        },
      },
    }, { status: 200, body: HOLDERS_FIXTURE }])
    const audit = await auditGmgnToken('solana', 'Concentrated1111111111111111111111111111111111')
    expect(audit!.riskLevel).toBe(3)
    expect(audit!.riskLabel).toBe('high')
    expect(audit!.distribution?.bundlerSoldPercent).toBe(0)
  })

  it('never claims authority/honeypot data it does not report', async () => {
    mockFetchSequence([
      { status: 200, body: AUDIT_SUCCESS_FIXTURE },
      { status: 200, body: HOLDERS_FIXTURE },
    ])
    const audit = await auditGmgnToken('solana', 'So11111111111111111111111111111111111111112')
    expect(audit!.canMint).toBe(false)
    expect(audit!.canFreeze).toBe(false)
    expect(audit!.isHoneypot).toBe(false)
    expect(audit!.buyTax).toBe(0)
    expect(audit!.sellTax).toBe(0)
  })

  it('rejects an unknown chain', async () => {
    expect(await auditGmgnToken('unknownchain', 'X')).toBeNull()
  })
})

// ── Session-file cookie support ──────────────────────────────

describe('gmgn session cookie resolution', () => {
  it('prefers file cookie over env (GMGN_SESSION_PATH override)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmgn-sess-'))
    const path = join(dir, 'gmgn-session.json')
    writeFileSync(path, JSON.stringify({ cookie: 'cf_clearance=filevalue' }))
    process.env.GMGN_SESSION_PATH = path
    process.env.GMGN_SESSION_COOKIE = 'envvalue'

    __resetGmgnCookieForTests()
    expect(__gmgnSessionCookieForTests()).toBe('cf_clearance=filevalue')

    delete process.env.GMGN_SESSION_PATH
    delete process.env.GMGN_SESSION_COOKIE
    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to env cookie when file absent', () => {
    process.env.GMGN_SESSION_PATH = join(tmpdir(), 'gmgn-nonexistent', 'gmgn-session.json')
    process.env.GMGN_SESSION_COOKIE = 'envvalue'

    __resetGmgnCookieForTests()
    expect(__gmgnSessionCookieForTests()).toBe('envvalue')

    delete process.env.GMGN_SESSION_PATH
    delete process.env.GMGN_SESSION_COOKIE
  })

  it('returns null when neither file nor env present', () => {
    process.env.GMGN_SESSION_PATH = join(tmpdir(), 'gmgn-nonexistent', 'gmgn-session.json')
    delete process.env.GMGN_SESSION_COOKIE

    __resetGmgnCookieForTests()
    expect(__gmgnSessionCookieForTests()).toBeNull()

    delete process.env.GMGN_SESSION_PATH
  })

  it('attaches file cookie as request header', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gmgn-sess-'))
    const path = join(dir, 'gmgn-session.json')
    writeFileSync(path, JSON.stringify({ cookie: 'cf_clearance=hdrtest' }))
    process.env.GMGN_SESSION_PATH = path
    __resetGmgnCookieForTests()

    let seen: string[] = []
    __setGmgnCurlForTests((args) => {
      seen = args
      return `${JSON.stringify({ data: { list: [] } })}\nCURL_STATUS:200`
    })

    await discoverGmgnTokens(1)
    expect(seen.length).toBeGreaterThan(0)
    const cookieIdx = seen.findIndex((a) => a === 'Cookie: cf_clearance=hdrtest')
    expect(cookieIdx).toBeGreaterThan(-1)

    delete process.env.GMGN_SESSION_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  it('omits cookie header when no session source', async () => {
    process.env.GMGN_SESSION_PATH = join(tmpdir(), 'gmgn-nonexistent', 'gmgn-session.json')
    delete process.env.GMGN_SESSION_COOKIE
    __resetGmgnCookieForTests()

    let seen: string[] = []
    __setGmgnCurlForTests((args) => {
      seen = args
      return `${JSON.stringify({ data: { list: [] } })}\nCURL_STATUS:200`
    })

    await discoverGmgnTokens(1)
    expect(seen.some((a) => a.startsWith('Cookie:'))).toBe(false)

    delete process.env.GMGN_SESSION_PATH
  })
})


// ── Registry session-file gating ─────────────────────────────

describe('MEME_REGISTRY session-file gating', () => {
  it('enables gmgn when GMGN session file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-gate-'))
    const path = join(dir, 'gmgn-session.json')
    writeFileSync(path, JSON.stringify({ cookie: 'x' }))
    process.env.GMGN_SESSION_PATH = path
    delete process.env.GMGN_SESSION_COOKIE

    vi.resetModules()
    const { MEME_REGISTRY } = (await import('../index')) as unknown as { MEME_REGISTRY: Record<string, { enabled: boolean }> }
    expect(MEME_REGISTRY.gmgn.enabled).toBe(true)
    expect(MEME_REGISTRY.fomo.enabled).toBe(false)

    delete process.env.GMGN_SESSION_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  it('enables fomo when FOMO session file exists (without FOMO_API_ENABLED)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-gate-'))
    const path = join(dir, 'fomo-session.json')
    writeFileSync(path, JSON.stringify({ cookie: 'x' }))
    process.env.FOMO_SESSION_PATH = path
    delete process.env.FOMO_API_ENABLED

    vi.resetModules()
    const { MEME_REGISTRY } = (await import('../index')) as unknown as { MEME_REGISTRY: Record<string, { enabled: boolean }> }
    expect(MEME_REGISTRY.fomo.enabled).toBe(true)

    delete process.env.FOMO_SESSION_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  it('leaves both disabled when no env and no session files', async () => {
    process.env.GMGN_SESSION_PATH = join(tmpdir(), 'reg-gate-none', 'gmgn-session.json')
    process.env.FOMO_SESSION_PATH = join(tmpdir(), 'reg-gate-none', 'fomo-session.json')
    delete process.env.GMGN_SESSION_COOKIE
    delete process.env.FOMO_API_ENABLED

    vi.resetModules()
    const { MEME_REGISTRY } = (await import('../index')) as unknown as { MEME_REGISTRY: Record<string, { enabled: boolean }> }
    expect(MEME_REGISTRY.gmgn.enabled).toBe(false)
    expect(MEME_REGISTRY.fomo.enabled).toBe(false)

    delete process.env.GMGN_SESSION_PATH
    delete process.env.FOMO_SESSION_PATH
  })
})
