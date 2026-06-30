// ─────────────────────────────────────────────────────────────
// Integration tests for critical API endpoints
// Tests real HTTP responses, data shape, cache behavior
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4400'

async function api(path: string) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000) })
  const json = await res.json() as { data: unknown; error: string | null; meta?: unknown }
  return { status: res.status, ...json, headers: res.headers }
}

describe('API Integration Tests', () => {
  describe('Market Data APIs', () => {
    it('GET /api/v1/derivatives returns real data', async () => {
      const { status, data, error } = await api('/api/v1/derivatives?limit=5')
      expect(status).toBe(200)
      expect(error).toBeNull()
      expect(data).toBeTruthy()
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.topPairs)).toBe(true)
      expect((d.topPairs as unknown[]).length).toBeGreaterThan(0)
    })

    it('GET /api/v1/fear-greed returns score', async () => {
      const { status, data } = await api('/api/v1/fear-greed')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(d.composite).toBeTruthy()
      expect(typeof (d.composite as Record<string, unknown>).score).toBe('number')
    })

    it('GET /api/v1/market/prices returns tickers', async () => {
      const { status, data } = await api('/api/v1/market/prices')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.tickers)).toBe(true)
      expect((d.tickers as unknown[]).length).toBeGreaterThan(0)
    })
  })

  describe('On-Chain APIs', () => {
    it('GET /api/v1/whale-alert returns alerts', async () => {
      const { status, data } = await api('/api/v1/whale-alert')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.items)).toBe(true)
      expect((d.items as unknown[]).length).toBeGreaterThan(0)
    })

    it('GET /api/v1/entities returns entities from DB', async () => {
      const { status, data } = await api('/api/v1/entities?pageSize=5')
      expect(status).toBe(200)
      expect(data).toBeTruthy()
    })

    it('GET /api/v1/entities/graph returns nodes and links', async () => {
      const { status, data } = await api('/api/v1/entities/graph')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.nodes)).toBe(true)
      expect(Array.isArray(d.links)).toBe(true)
      expect((d.nodes as unknown[]).length).toBeGreaterThan(0)
    })

    it('GET /api/v1/smart-money returns wallets', async () => {
      const { status, data } = await api('/api/v1/smart-money')
      expect(status).toBe(200)
      expect(data).toBeTruthy()
    })
  })

  describe('DEX APIs', () => {
    it('GET /api/v1/dex/trending returns pools or graceful failure', async () => {
      const { status, data } = await api('/api/v1/dex/trending?network=solana')
      // GeckoTerminal may be unavailable — accept 200 or 502
      expect([200, 502]).toContain(status)
      if (status === 200) {
        const d = data as Record<string, unknown>
        expect(Array.isArray(d.items)).toBe(true)
        expect((d.items as unknown[]).length).toBeGreaterThan(0)
      }
    })

    it('GET /api/v1/dex/new-pairs returns pools or graceful failure', async () => {
      const { status, data } = await api('/api/v1/dex/new-pairs?network=solana')
      // GeckoTerminal may be unavailable — accept 200 or 502
      expect([200, 502]).toContain(status)
      if (status === 200) {
        const d = data as Record<string, unknown>
        expect(Array.isArray(d.items)).toBe(true)
      }
    })
  })

  describe('Cache Behavior', () => {
    it('Cached endpoints return X-Cache header', async () => {
      // Warm up
      await api('/api/v1/whale-alert')
      const res = await fetch(`${BASE}/api/v1/whale-alert`)
      const cacheHeader = res.headers.get('x-cache')
      expect(cacheHeader).toBe('HIT')
    })

    it('GET /api/v1/status/cache returns cache stats', async () => {
      const { status, data } = await api('/api/v1/status/cache')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(d.memory).toBeTruthy()
      expect(d.redis).toBeTruthy()
    })
  })

  describe('Macro & News', () => {
    it('GET /api/v1/macro returns indicators', async () => {
      const { status, data } = await api('/api/v1/macro')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.indicators)).toBe(true)
    })

    it('GET /api/v1/news returns articles or graceful failure', { timeout: 30_000 }, async () => {
      const { status, data } = await api('/api/v1/news?limit=5')
      // RSS feeds may be slow — accept 200 or 504 timeout
      expect([200, 504]).toContain(status)
      if (status === 200) {
        const d = data as Record<string, unknown>
        expect(d.items).toBeTruthy()
        expect(Array.isArray(d.items)).toBe(true)
      }
    })

    it('GET /api/v1/calendar returns events', async () => {
      const { status, data } = await api('/api/v1/calendar')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.events)).toBe(true)
    })
  })

  describe('DeFi APIs', () => {
    it('GET /api/v1/yields returns pools', async () => {
      const { status, data } = await api('/api/v1/yields')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.topYields)).toBe(true)
      expect((d.topYields as unknown[]).length).toBeGreaterThan(0)
    })

    it('GET /api/v1/revenue returns protocols', async () => {
      const { status, data } = await api('/api/v1/revenue')
      expect(status).toBe(200)
      const d = data as Record<string, unknown>
      expect(Array.isArray(d.protocols)).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('Missing required param returns 400', async () => {
      const { status } = await api('/api/v1/token/god-mode')
      expect(status).toBe(400)
    })

    it('Invalid action returns 400', async () => {
      const { status } = await api('/api/v1/mempool?action=invalid')
      expect(status).toBe(400)
    })
  })
})
