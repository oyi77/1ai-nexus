import { afterEach, describe, expect, it, vi } from 'vitest'

interface MockResponse {
  status: number
  body: string
  hang?: boolean
}

type Listener = (...args: unknown[]) => void

const h = vi.hoisted(() => {
  const responses: MockResponse[] = []
  const requests: Array<{ timeout?: () => void; listeners: Record<string, Listener[]> }> = []

  const request = vi.fn(
    (
      _options: unknown,
      callback: (response: { statusCode: number; on: (event: string, cb: Listener) => void }) => void,
    ) => {
      const listeners: Record<string, Listener[]> = {}
      const state = { listeners } as { timeout?: () => void; listeners: Record<string, Listener[]> }
      requests.push(state)
      const responseListeners: Record<string, Listener[]> = {}
      const response = {
        statusCode: 200,
        on(event: string, cb: Listener) {
          responseListeners[event] = responseListeners[event] ?? []
          responseListeners[event].push(cb)
          return response
        },
      }
      const req = {
        on(event: string, cb: Listener) {
          listeners[event] = listeners[event] ?? []
          listeners[event].push(cb)
          return req
        },
        setTimeout(_ms: number, cb: () => void) {
          state.timeout = cb
          return req
        },
        write() {},
        destroy(error: Error) {
          for (const listener of listeners.error ?? []) listener(error)
        },
        end() {
          const next = responses.shift() ?? { status: 200, body: '{"data":{"list":[]}}' }
          if (next.hang) return
          response.statusCode = next.status
          queueMicrotask(() => {
            callback(response)
            for (const listener of responseListeners.data ?? []) listener(Buffer.from(next.body))
            for (const listener of responseListeners.end ?? []) listener()
          })
        },
      }
      return req
    },
  )

  return { responses, requests, request }
})

vi.mock('node:https', () => ({
  default: { request: h.request },
}))

import { discoverBitgetTokens } from '../bitget'

function mockHttps(responses: MockResponse[]) {
  h.responses.length = 0
  h.responses.push(...responses)
  h.requests.length = 0
}

afterEach(() => {
  vi.useRealTimers()
  h.responses.length = 0
  h.requests.length = 0
})

const BITGET_TOKEN = {
  chain: 'BSC',
  contract: '0xBitgetToken000000000000000000000000000001',
  symbol: 'BGT',
  name: 'Bitget Token',
  price: '1.25',
  change_24h: '0.08',
  volume_24h: '9876',
  market_cap: '500000',
  issue_date: 1788000000, // seconds (upstream unit varies per row)
  holders: 42,
  top10_holder_percent: '0.31',
  risk_level: 'low',
}

describe('discoverBitgetTokens', () => {
  it('preserves Bitget identity and discovery provenance', async () => {
    mockHttps([
      { status: 200, body: JSON.stringify({ data: { list: [BITGET_TOKEN] } }) },
      { status: 200, body: JSON.stringify({ data: { list: [] } }) },
      { status: 200, body: JSON.stringify({ data: { list: [] } }) },
      { status: 200, body: JSON.stringify({ data: { list: [] } }) },
    ])

    const tokens = await discoverBitgetTokens(1)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].platform).toBe('bitget')
    // Measured defect 2026-10-07: bitget emits SOL/BSC/ETH/BASE short labels.
    expect(tokens[0].chain).toBe('binance-smart-chain')
    expect(tokens[0].provenance).toEqual({
      sourceType: 'public-api',
      provider: 'bitget',
      experimental: true,
      note: 'Bitget Wallet topRank discovery feed, not a security audit',
    })
    expect(tokens[0].riskKnown).toBe(false)
  })

  it('throws the upstream status and body snippet for non-2xx responses', async () => {
    mockHttps([{ status: 502, body: '{"error":"bitget upstream body snippet"}' }])

    await expect(discoverBitgetTokens(1)).rejects.toThrow(
      'Bitget 502: /market/v3/topRank/detail — {"error":"bitget upstream body snippet"}',
    )
  })

  it('rejects when the upstream request is aborted by the timeout', async () => {
    vi.useFakeTimers()
    mockHttps([{ status: 200, body: '', hang: true }])

    const pending = discoverBitgetTokens(1)
    await vi.advanceTimersByTimeAsync(10_000)
    h.requests[0].timeout?.()
    await expect(pending).rejects.toThrow('Bitget request timeout: /market/v3/topRank/detail')
  })
})
