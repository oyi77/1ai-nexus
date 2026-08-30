// ─────────────────────────────────────────────────────────────
// Birdeye Forge adapter unit tests (fixture-backed, no network).
// The adapter uses node:http2 (Cloudflare blocks undici fetch), so
// this mocks the http2 connect() client — asserts normalization + errors.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest'
import { discoverBirdeyeTokens, auditBirdeyeToken, getBirdeyeTotalHolders } from '../birdeye'

type Listener = (...args: unknown[]) => void
interface MockResponse { status: number; body: string }

// hoisted state so the vi.mock factory (hoisted above imports) can read it
const h = vi.hoisted(() => {
  const responses: MockResponse[] = []
  function makeFakeClient() {
    const listeners: Record<string, Listener[]> = {}
    const client = {
      on(event: string, cb: Listener) {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(cb)
        return client
      },
      request() {
        const reqListeners: Record<string, Listener[]> = {}
        const req = {
          on(event: string, cb: Listener) {
            reqListeners[event] = reqListeners[event] ?? []
            reqListeners[event].push(cb)
            return req
          },
          end() {
            const next = responses.shift() ?? { status: 200, body: '{"data":{}}' }
            ;(reqListeners['response'] ?? []).forEach((cb) => cb({ ':status': next.status }))
            ;(reqListeners['data'] ?? []).forEach((cb) => cb(Buffer.from(next.body)))
            ;(reqListeners['end'] ?? []).forEach((cb) => cb())
          },
        }
        return req
      },
      close() {},
    }
    queueMicrotask(() => {
      ;(listeners['connect'] ?? []).forEach((cb) => cb())
    })
    return client
  }
  return { responses, makeFakeClient }
})

vi.mock('node:http2', () => ({
  connect: () => h.makeFakeClient(),
}))

function mockHttp2(responses: MockResponse[]) {
  h.responses.length = 0
  h.responses.push(...responses)
}

afterEach(() => {
  h.responses.length = 0
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
    mockHttp2([{ status: 200, body: JSON.stringify({ success: true, data: { items: [GEM] } }) }])
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
  })

  it('throws on upstream error (per-source isolation)', async () => {
    mockHttp2([{ status: 500, body: '{}' }])
    await expect(discoverBirdeyeTokens()).rejects.toThrow()
  })

  it('dedupes identical contracts', async () => {
    mockHttp2([{ status: 200, body: JSON.stringify({ success: true, data: { items: [GEM, GEM] } }) }])
    const tokens = await discoverBirdeyeTokens(25)
    expect(tokens).toHaveLength(1)
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
    mockHttp2([
      { status: 200, body: JSON.stringify(security) },
      { status: 200, body: JSON.stringify(auditRes) },
    ])
    const result = await auditBirdeyeToken('solana', 'TestMint')
    expect(result).not.toBeNull()
    expect(result!.platform).toBe('birdeye')
    expect(result!.riskLevel).toBe(3)
    expect(result!.riskLabel).toBe('high')
    expect(result!.riskCounts).toEqual({ high: 2, middle: 1, low: 0 })
    expect(result!.canMint).toBe(true)
    expect(result!.top10HolderPercent).toBe(0.35)
  })

  it('returns null when security endpoint fails', async () => {
    mockHttp2([{ status: 500, body: '{}' }])
    expect(await auditBirdeyeToken('solana', 'TestMint')).toBeNull()
  })
})

describe('getBirdeyeTotalHolders', () => {
  it('returns holder count from upstream', async () => {
    mockHttp2([{ status: 200, body: JSON.stringify({ success: true, data: { total: 8102218 } }) }])
    expect(await getBirdeyeTotalHolders('addr')).toBe(8102218)
  })

  it('returns 0 on failure', async () => {
    mockHttp2([{ status: 500, body: '{}' }])
    expect(await getBirdeyeTotalHolders('addr')).toBe(0)
  })
})