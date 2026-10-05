import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverGateTokens } from '../gate'

const GATE_TOKEN = {
  chain: 'bsc',
  address: '0xGateToken00000000000000000000000000000001',
  symbol: 'GATE',
  name: 'Gate Token',
  liquidity: '12345.67',
  holder_count: 321,
  created_at: '2026-08-01T00:00:00.000Z',
  trend_info: {
    price_change_24h: '0.12',
    volume_24h: '45678.9',
  },
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string, init?: RequestInit) => {
      const next = queue.shift() ?? { status: 200, body: { data: { tokens: [] } } }
      // Keep the signal in the mock so the timeout test exercises the adapter's
      // AbortSignal wiring rather than merely rejecting an arbitrary promise.
      if (init?.signal?.aborted) throw new Error('request aborted')
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('discoverGateTokens', () => {
  it('preserves Gate identity and discovery provenance', async () => {
    mockFetchSequence([
      { status: 200, body: { data: { tokens: [GATE_TOKEN] } } },
      { status: 200, body: { data: { tokens: [] } } },
      { status: 200, body: { data: { tokens: [] } } },
      { status: 200, body: { data: { tokens: [] } } },
    ])

    const tokens = await discoverGateTokens(1)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].platform).toBe('gate')
    expect(tokens[0].provenance).toEqual({
      sourceType: 'public-api',
      provider: 'gate',
      experimental: true,
      note: 'Gate Web3 OpenAPI discovery feed, not a security audit',
    })
    expect(tokens[0].riskKnown).toBe(false)
  })

  it('throws the upstream status and body snippet for non-2xx responses', async () => {
    mockFetchSequence([{ status: 503, body: { error: 'gate maintenance body snippet' } }])

    await expect(discoverGateTokens(1)).rejects.toThrow(
      'Gate 503: base.token.range_by_created_at — {"error":"gate maintenance body snippet"}',
    )
  })

  it('rejects when the upstream request is aborted by the timeout signal', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')))
          }),
      ),
    )

    const pending = discoverGateTokens(1)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).rejects.toThrow('request aborted')
  })
})
