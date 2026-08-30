// ─────────────────────────────────────────────────────────────
// GeckoTerminal adapter unit tests (fixture-backed, no network).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest'
import { discoverGeckoTerminalTokens } from '../geckoterminal'

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

afterEach(() => { vi.unstubAllGlobals() })

const POOL = {
  id: 'solana_TestPool1111111111111111111111111111111111',
  type: 'pool',
  attributes: {
    base_token_price_usd: '0.00123',
    address: 'TestPool1111111111111111111111111111111111',
    name: 'TEST / SOL',
    pool_created_at: '2026-08-30T10:00:00Z',
    fdv_usd: '500000',
    market_cap_usd: '450000',
    price_change_percentage: { h24: '15.5', h1: '2.1', m5: '0.3' },
    volume_usd: '125000',
    reserve_in_usd: '30000',
  },
  relationships: {
    base_token: { data: { id: 'solana_TestMint11111111111111111111111111111111111111', type: 'token' } },
    quote_token: { data: { id: 'solana_So11111111111111111111111111111111111111112', type: 'token' } },
  },
}

describe('discoverGeckoTerminalTokens', () => {
  it('normalizes a trending pool to MemeAlphaToken', async () => {
    mockFetchOnce(200, { data: [POOL] })
    const tokens = await discoverGeckoTerminalTokens(25)
    expect(tokens).toHaveLength(1)
    const t = tokens[0]
    expect(t.platform).toBe('geckoterminal')
    expect(t.chain).toBe('solana')
    expect(t.contract).toBe('TestMint11111111111111111111111111111111111111')
    expect(t.symbol).toBe('TEST')
    expect(t.price).toBeCloseTo(0.00123)
    expect(t.change24h).toBeCloseTo(0.155)
    expect(t.volume24h).toBe(125000)
    expect(t.marketCap).toBe(450000)
    expect(t.liquidity).toBe(30000)
    expect(t.createdAt).toBe(new Date('2026-08-30T10:00:00Z').getTime())
  })

  it('returns empty array on upstream failure', async () => {
    mockFetchOnce(500, {})
    const tokens = await discoverGeckoTerminalTokens(25)
    expect(tokens).toEqual([])
  })

  it('dedupes across trending + new pages', async () => {
    mockFetchOnce(200, { data: [POOL, POOL] })
    const tokens = await discoverGeckoTerminalTokens(25)
    expect(tokens).toHaveLength(1)
  })
})