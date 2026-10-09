// ─────────────────────────────────────────────────────────────
// Birdeye Forge adapter unit tests (fixture-backed, no network).
// The adapter shells to system curl (Cloudflare blocks all Node TLS
// stacks), so this stubs the __setBirdeyeCurlForTests seam — asserts
// normalization + error contract.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  discoverBirdeyeTokens,
  auditBirdeyeToken,
  getBirdeyeTotalHolders,
  __setBirdeyeCurlForTests,
} from '../birdeye'

interface MockResponse { status: number; body: string; hang?: boolean }

function mockCurl(responses: MockResponse[]) {
  const queue = [...responses]
  __setBirdeyeCurlForTests(() => {
    const next = queue.shift() ?? { status: 200, body: '{"data":{}}' }
    if (next.hang) {
      const err = new Error('curl timeout') as Error & { killed: boolean }
      err.killed = true
      throw err
    }
    return `${next.body}\nCURL_STATUS:${next.status}`
  })
}

afterEach(() => {
  __setBirdeyeCurlForTests(null)
  vi.useRealTimers()
})

const GEM = {
  symbol: 'TEST',
  address: 'TestMint11111111111111111111111111111111111111',
  name: 'Test Token',
  network: 'solana',
  liquidity: 100000,
  price: 0.01,
  mc: 5000000,
  fdmc: 8000000,
  holderCount: 1200,
  top10HolderPercent: 0.4,
  createdAt: 1788000000000,
  birdeyeStrict: false,
  jupStrict: false,
  extensions: { twitter: 'https://x.com/test', website: 'https://test.xyz' },
  tf24h: { volumeUSD: 250000, priceChangePercent: 30, uniqueWallets: 400, tradeCount: 5000 },
}

describe('discoverBirdeyeTokens', () => {
  it('normalizes gems to MemeAlphaToken shape', async () => {
    mockCurl([{ status: 200, body: JSON.stringify({ success: true, data: { items: [GEM] } }) }])
    const tokens = await discoverBirdeyeTokens(25)
    expect(tokens).toHaveLength(1)
    const t = tokens[0]
    expect(t.platform).toBe('birdeye')
    expect(t.chain).toBe('solana')
    expect(t.contract).toBe(GEM.address)
    expect(t.symbol).toBe('TEST')
    expect(t.price).toBe(0.01)
    expect(t.change24h).toBeCloseTo(0.3)
    expect(t.volume24h).toBe(250000)
    expect(t.marketCap).toBe(5000000)
    expect(t.liquidity).toBe(100000)
    expect(t.createdAt).toBe(1788000000000)
    expect(t.holders).toBe(1200)
    expect(t.top10HolderPercent).toBe(0.4)
    expect(t.social.twitter).toBe('https://x.com/test')
    expect(t.social.site).toBe('https://test.xyz')
    expect(t.provenance).toEqual({
      sourceType: 'reverse-engineered',
      provider: 'birdeye',
      experimental: true,
      note: 'Forge API RE-ed from birdeye.so frontend; not public-api.birdeye.so',
    })
    expect(t.riskKnown).toBe(false)
    expect(t.audited).toBe(false)
  })

  it('throws on upstream error (per-source isolation)', async () => {
    mockCurl([{ status: 500, body: '{}' }])
    await expect(discoverBirdeyeTokens()).rejects.toThrow('Birdeye 500: /v3/gems')
  })

  it('surfaces non-2xx as `Birdeye ${status}: ${path}` through curl transport', async () => {
    mockCurl([{ status: 403, body: '<html>challenge</html>' }])
    await expect(discoverBirdeyeTokens()).rejects.toThrow('Birdeye 403: /v3/gems')
  })

  it('dedupes identical contracts', async () => {
    mockCurl([{ status: 200, body: JSON.stringify({ success: true, data: { items: [GEM, GEM] } }) }])
    const tokens = await discoverBirdeyeTokens(25)
    expect(tokens).toHaveLength(1)
  })

  it('rejects on oversized response (bounded memory)', async () => {
    mockCurl([{ status: 200, body: 'x'.repeat(1_048_577) }])
    await expect(discoverBirdeyeTokens()).rejects.toThrow('too large')
  })

  it('rejects with timeout error when curl is killed', async () => {
    mockCurl([{ status: 200, body: '', hang: true }])
    await expect(discoverBirdeyeTokens()).rejects.toThrow('Birdeye request timeout')
  })
})

describe('auditBirdeyeToken', () => {
  it('maps critical security to riskLevel 3 + counts', async () => {
    const security = {
      success: true,
      data: {
        groups: [
          { name: 'Critical', rows: [{ id: 'honeypot', severity: 5, name: 'Honeypot' }] },
          { name: 'High', rows: [{ id: 'mint_authority', severity: 4, name: 'Mint Authority' }] },
          { name: 'Medium', rows: [{ id: 'transfer_restriction', severity: 3, name: 'Transfer Restriction' }] },
        ],
      },
    }
    const auditRes = { success: true, data: { top10Holders: { percentage: 0.35, wallets: 10 } } }
    mockCurl([
      { status: 200, body: JSON.stringify(security) },
      { status: 200, body: JSON.stringify(auditRes) },
    ])
    const result = await auditBirdeyeToken('solana', 'TestMint')
    expect(result).not.toBeNull()
    expect(result!.platform).toBe('birdeye')
    expect(result!.riskLevel).toBe(3)
    expect(result!.riskLabel).toBe('high')
    expect(result!.riskCounts).toEqual({ high: 2, middle: 1, low: 0 })
    // security_details rows are a STATIC check catalog (proven 2026-10-09:
    // identical 61 rows for a renounced-mint token vs a fresh pump token) —
    // row presence proves nothing, so authority flags stay false here.
    expect(result!.canMint).toBe(false)
    expect(result!.top10HolderPercent).toBe(0.35)
  })

  it('returns null when security endpoint fails', async () => {
    mockCurl([{ status: 500, body: '{}' }])
    expect(await auditBirdeyeToken('solana', 'TestMint')).toBeNull()
  })
})

describe('getBirdeyeTotalHolders', () => {
  it('returns holder count from upstream', async () => {
    mockCurl([{ status: 200, body: JSON.stringify({ success: true, data: { total: 8102218 } }) }])
    expect(await getBirdeyeTotalHolders('addr')).toBe(8102218)
  })

  it('returns 0 on failure', async () => {
    mockCurl([{ status: 500, body: '{}' }])
    expect(await getBirdeyeTotalHolders('addr')).toBe(0)
  })
})
