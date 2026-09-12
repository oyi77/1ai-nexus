// Direct GET-handler unit test for /api/v1/fear-greed.
// No server, no port, no network: exercises route.ts logic in isolation.
//
// Regression guard: the cached fetch callback must THROW on an upstream failure,
// not return a response object. Returning `apiError(...)` made it the cached
// value, which the outer `apiSuccess` then serialised to `{}` — a truthy payload
// with no `composite` that crashed /fear-greed, /macro and /macro-hub with
// "Cannot read properties of undefined (reading 'score')".
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'
import * as coinpaprika from '@/lib/coinpaprika'

// Pass-through cache: always miss, and let a thrown error propagate exactly as
// the real single-flight implementation does.
vi.mock('@/lib/api/server-cache', () => ({
  getCached: async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => ({
    data: await fetcher(),
    fromCache: false,
  }),
}))

vi.mock('@/lib/coinpaprika', () => ({
  getGlobal: vi.fn(),
  getTicker: vi.fn(),
}))

const mockGetGlobal = coinpaprika.getGlobal as unknown as Mock
const mockGetTicker = coinpaprika.getTicker as unknown as Mock

const GECKO_GLOBAL = {
  data: {
    market_cap_change_percentage_24h_usd: 1.5,
    active_cryptocurrencies: 10_000,
    markets: 900,
    total_market_cap: { btc: 1, usd: 2_000_000_000_000 },
    total_volume: { btc: 1, usd: 100_000_000_000 },
    market_cap_percentage: { btc: 52, eth: 18 },
  },
}

function stubUpstream(fngPayload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url)
      const body = href.includes('alternative.me') ? fngPayload : GECKO_GLOBAL
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    }),
  )
}

async function call() {
  const { GET } = await import('./route')
  const res = await GET(new NextRequest('http://localhost/api/v1/fear-greed'))
  const body = (await res.json()) as { data: unknown; error: string | null }
  return { status: res.status, ...body }
}

describe('GET /api/v1/fear-greed (handler unit test)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    mockGetGlobal.mockReset().mockResolvedValue({
      market_cap_usd: 2_000_000_000_000,
      market_cap_change_24h: 1.2,
      volume_24h_usd: 100_000_000_000,
      volume_24h_change_24h: 4,
    } as never)
    mockGetTicker.mockReset().mockResolvedValue({ quotes: { USD: { price: 60_000 } } } as never)
  })

  it('empty alternative.me response: 502 with data null, never a truthy {} payload', async () => {
    stubUpstream({ name: 'Fear and Greed Index', data: [] })

    const { status, data, error } = await call()

    expect(status).toBe(502)
    expect(error).toBeTruthy()
    // The bug returned 200 with `data: {}` here, which consumers read as valid.
    expect(data).toBeNull()
  })

  it('success path returns a complete payload the gauge can render', async () => {
    stubUpstream({
      name: 'Fear and Greed Index',
      data: [
        { value: '56', value_classification: 'Greed', timestamp: '1757600000', time_until_update: '' },
        { value: '50', value_classification: 'Neutral', timestamp: '1757500000', time_until_update: '' },
      ],
    })

    const { status, data, error } = await call()
    const payload = data as {
      composite: { score: number; label: string }
      categories: Record<string, unknown>
      regime: { state: string; stance: string }
      headerMetrics: { btcDom: number; totalMcap: number }
    }

    expect(status).toBe(200)
    expect(error).toBeNull()
    expect(typeof payload.composite.score).toBe('number')
    expect(payload.composite.score).toBeGreaterThanOrEqual(0)
    expect(payload.composite.score).toBeLessThanOrEqual(100)
    expect(typeof payload.composite.label).toBe('string')
    expect(Object.keys(payload.categories).length).toBeGreaterThan(0)
    expect(typeof payload.regime.state).toBe('string')
    expect(typeof payload.headerMetrics.btcDom).toBe('number')
  })
})
