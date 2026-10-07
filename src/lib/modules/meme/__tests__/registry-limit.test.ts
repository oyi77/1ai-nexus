// ─────────────────────────────────────────────────────────────
// Registry limit-threading tests (fixture-backed, no network).
// Proves getDiscoveryModule(x).fetch({ limit }) caps output.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  const responses: Array<{ status: number; body: string }> = []
  const request = vi.fn(
    (
      _options: unknown,
      callback: (response: { statusCode: number; on: (event: string, cb: (...a: unknown[]) => void) => void }) => void,
    ) => {
      const responseListeners: Record<string, Array<(...a: unknown[]) => void>> = {}
      const response = {
        statusCode: 200,
        on(event: string, cb: (...a: unknown[]) => void) {
          responseListeners[event] = responseListeners[event] ?? []
          responseListeners[event].push(cb)
          return response
        },
      }
      const req = {
        on() { return req },
        setTimeout() { return req },
        write() {},
        destroy() {},
        end() {
          const next = responses.shift() ?? { status: 200, body: '{"data":{"list":[]}}' }
          response.statusCode = next.status
          queueMicrotask(() => {
            callback(response)
            for (const l of responseListeners.data ?? []) l(Buffer.from(next.body))
            for (const l of responseListeners.end ?? []) l()
          })
        },
      }
      return req
    },
  )
  return { responses, request }
})

vi.mock('node:https', () => ({
  default: { request: h.request },
}))

import { getDiscoveryModule } from '../index'

afterEach(() => { vi.unstubAllGlobals() })

function geckoPool(i: number) {
  const contract = `TestMint1111111111111111111111111111111111111${i}`
  return {
    id: `solana_TestPool11111111111111111111111111111111111${i}`,
    type: 'pool',
    attributes: {
      base_token_price_usd: '0.00123',
      address: `TestPool11111111111111111111111111111111111${i}`,
      name: `TEST${i} / SOL`,
      pool_created_at: '2026-08-30T10:00:00Z',
      market_cap_usd: '450000',
      price_change_percentage: { h24: '15.5' },
      volume_usd: '125000',
      reserve_in_usd: '30000',
      transactions: { h24: { buys: 120, sells: 40 } },
    },
    relationships: {
      base_token: { data: { id: `solana_${contract}`, type: 'token' } },
    },
  }
}

function stubGeckoFetch(pools: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: pools }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  )
}

function bitgetItem(i: number) {
  return {
    chain: 'BSC',
    contract: `0xBitgetToken000000000000000000000000000000${i}`,
    symbol: `BGT${i}`,
    name: `Bitget Token ${i}`,
    price: '1.25',
    holders: 42,
    risk_level: 'low',
  }
}

describe('registry limit threading', () => {
  it("geckoterminal fetch({ limit: 2 }) returns <= 2 tokens", async () => {
    stubGeckoFetch([geckoPool(1), geckoPool(2), geckoPool(3), geckoPool(4), geckoPool(5)])
    const mod = getDiscoveryModule('geckoterminal')
    expect(mod).toBeDefined()
    const res = await mod!.fetch<{ tokens: unknown[]; total: number }>({ platform: 'geckoterminal', limit: 2 })
    expect(res.data.tokens.length).toBeLessThanOrEqual(2)
    expect(res.data.total).toBe(res.data.tokens.length)
  })

  it('geckoterminal fetch without limit preserves existing default behavior', async () => {
    stubGeckoFetch([geckoPool(1), geckoPool(2)])
    const mod = getDiscoveryModule('geckoterminal')
    const res = await mod!.fetch<{ tokens: unknown[]; total: number }>({ platform: 'geckoterminal' })
    expect(res.data.tokens.length).toBe(2)
  })

  it('bitget fetch({ limit: 3 }) returns <= 3 tokens despite 4-chain fan-out', async () => {
    h.responses.length = 0
    h.responses.push(
      { status: 200, body: JSON.stringify({ data: { list: [bitgetItem(1), bitgetItem(2), bitgetItem(3), bitgetItem(4), bitgetItem(5)] } }) },
      { status: 200, body: JSON.stringify({ data: { list: [] } }) },
      { status: 200, body: JSON.stringify({ data: { list: [] } }) },
      { status: 200, body: JSON.stringify({ data: { list: [] } }) },
    )
    const mod = getDiscoveryModule('bitget')
    expect(mod).toBeDefined()
    const res = await mod!.fetch<{ tokens: unknown[]; total: number }>({ platform: 'bitget', limit: 3 })
    expect(res.data.tokens.length).toBeLessThanOrEqual(3)
    expect(res.data.total).toBe(res.data.tokens.length)
    h.responses.length = 0
  })
})
