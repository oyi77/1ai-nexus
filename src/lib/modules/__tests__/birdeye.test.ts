// ─────────────────────────────────────────────────────────────
// Birdeye RE Module Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import birdeyeModule from '../onchain/birdeye/tokens'

// Mock cachedFetch to avoid real HTTP calls
vi.mock('../fetch-with-cache', () => ({
  cachedFetch: vi.fn(),
}))

describe('Birdeye RE Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('module definition', () => {
    it('has correct id', () => {
      expect(birdeyeModule.id).toBe('birdeye-re')
    })

    it('has correct name', () => {
      expect(birdeyeModule.name).toBe('Birdeye')
    })

    it('has correct category', () => {
      expect(birdeyeModule.category).toBe('onchain')
    })

    it('has correct sourceType', () => {
      expect(birdeyeModule.sourceType).toBe('re')
    })

    it('has provenance with all required fields', () => {
      expect(birdeyeModule.provenance.describesItself).toBeTruthy()
      expect(typeof birdeyeModule.provenance.describesItself).toBe('string')
      expect(birdeyeModule.provenance.fragility).toBe('fragile')
      expect(birdeyeModule.provenance.lastVerified).toBe('2026-06-19')
      expect(birdeyeModule.provenance.toleratesAbsence).toBe(true)
      expect(birdeyeModule.provenance.upstreamProduct).toBe('Birdeye')
    })
  })

  describe('isEnabled()', () => {
    it('returns true', () => {
      expect(birdeyeModule.isEnabled()).toBe(true)
    })
  })

  describe('healthCheck()', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })

    it('returns active health when fetch succeeds', async () => {
      const mockData = { data: { success: true } }
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve(mockData),
      } as Response
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const health = await birdeyeModule.healthCheck()

      expect(health.status).toBe('active')
      expect(health.lastChecked).toBeInstanceOf(Date)
      expect(health.lastSuccess).toBeInstanceOf(Date)
      expect(health.failureCount).toBe(0)
    })

    it('returns degraded health when fetch fails', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

      const health = await birdeyeModule.healthCheck()

      expect(health.status).toBe('degraded')
      expect(health.lastChecked).toBeInstanceOf(Date)
      expect(health.failureCount).toBe(1)
      expect(health.notes).toBe('May need GeckoTerminal fallback')
    })
  })

  describe('fetch()', () => {
    it('returns ModuleResult shape from cachedFetch', async () => {
      const { cachedFetch } = await import('../fetch-with-cache')
      const expectedResult = {
        data: { tokens: [] },
        source: 'birdeye-re',
        cached: false,
        timestamp: Date.now(),
        ttl: 60_000,
      }
      vi.mocked(cachedFetch).mockResolvedValue(expectedResult)

      const result = await birdeyeModule.fetch({ action: 'trending' })
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('source')
      expect(result).toHaveProperty('cached')
      expect(result).toHaveProperty('timestamp')
      expect(result).toHaveProperty('ttl')
    })

    it('calls cachedFetch with correct module id and params', async () => {
      const { cachedFetch } = await import('../fetch-with-cache')
      vi.mocked(cachedFetch).mockResolvedValue({
        data: {},
        source: 'birdeye-re',
        cached: false,
        timestamp: Date.now(),
        ttl: 0,
      })

      await birdeyeModule.fetch({ action: 'trending' })

      expect(cachedFetch).toHaveBeenCalledWith(
        'birdeye-re',
        { action: 'trending' },
        expect.any(Number),
        expect.any(Function),
      )
    })
  })

  describe('fallbackFn()', () => {
    it('is a function', () => {
      expect(typeof birdeyeModule.fallbackFn).toBe('function')
    })

    it('delegates to geckoterminal via registry', async () => {
      // Mock the registry's fetchOne
      const { getRegistry } = await import('../registry')
      const registry = getRegistry()
      const fetchOneMock = vi.fn().mockResolvedValue({
        data: { pairs: [] },
        source: 'geckoterminal (fallback)',
        cached: true,
        timestamp: Date.now(),
        ttl: 10_000,
      })
      registry.fetchOne = fetchOneMock

      const result = await birdeyeModule.fallbackFn!({ action: 'trending', limit: 20 })

      expect(fetchOneMock).toHaveBeenCalledWith('geckoterminal', { action: 'trending', limit: 20 })
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('source')
    })
  })
})
