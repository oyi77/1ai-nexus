// ─────────────────────────────────────────────────────────────
// Arkham RE Module Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import arkhamModule from '../onchain/arkham/entities'

// Mock cachedFetch to avoid real HTTP calls
vi.mock('../fetch-with-cache', () => ({
  cachedFetch: vi.fn(),
}))

describe('Arkham RE Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('module definition', () => {
    it('has correct id', () => {
      expect(arkhamModule.id).toBe('arkham-re')
    })

    it('has correct name', () => {
      expect(arkhamModule.name).toBe('Arkham Intelligence')
    })

    it('has correct category', () => {
      expect(arkhamModule.category).toBe('onchain')
    })

    it('has correct sourceType', () => {
      expect(arkhamModule.sourceType).toBe('re')
    })

    it('has provenance with all required fields', () => {
      expect(arkhamModule.provenance.describesItself).toBeTruthy()
      expect(typeof arkhamModule.provenance.describesItself).toBe('string')
      expect(arkhamModule.provenance.fragility).toBe('fragile')
      expect(arkhamModule.provenance.lastVerified).toBe('2026-06-19')
      expect(arkhamModule.provenance.toleratesAbsence).toBe(true)
      expect(arkhamModule.provenance.upstreamProduct).toBe('Arkham Intelligence')
    })
  })

  describe('isEnabled()', () => {
    it('returns true', () => {
      expect(arkhamModule.isEnabled()).toBe(true)
    })
  })

  describe('healthCheck()', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })

    it('returns active health when fetch succeeds', async () => {
      const mockData = { data: [{ id: 'binance', label: 'Binance' }] }
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve(mockData),
      } as Response
      vi.mocked(fetch).mockResolvedValue(mockResponse)

      const health = await arkhamModule.healthCheck()

      expect(health.status).toBe('active')
      expect(health.lastChecked).toBeInstanceOf(Date)
      expect(health.lastSuccess).toBeInstanceOf(Date)
      expect(health.failureCount).toBe(0)
    })

    it('returns degraded health when fetch fails', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

      const health = await arkhamModule.healthCheck()

      expect(health.status).toBe('degraded')
      expect(health.lastChecked).toBeInstanceOf(Date)
      expect(health.failureCount).toBe(1)
      expect(health.notes).toBe('Using seed data fallback')
    })
  })

  describe('fetch()', () => {
    it('returns ModuleResult shape from cachedFetch', async () => {
      const { cachedFetch } = await import('../fetch-with-cache')
      const expectedResult = {
        data: { entity: { name: 'Binance' } },
        source: 'arkham-re',
        cached: false,
        timestamp: Date.now(),
        ttl: 600_000,
      }
      vi.mocked(cachedFetch).mockResolvedValue(expectedResult)

      const result = await arkhamModule.fetch({ action: 'entity', address: '0x123' })
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
        source: 'arkham-re',
        cached: false,
        timestamp: Date.now(),
        ttl: 0,
      })

      await arkhamModule.fetch({ action: 'entity', address: '0x123', chain: 'eth' })

      expect(cachedFetch).toHaveBeenCalledWith(
        'arkham-re',
        { action: 'entity', address: '0x123', chain: 'eth' },
        expect.any(Number),
        expect.any(Function),
      )
    })

    it('works with search action', async () => {
      const { cachedFetch } = await import('../fetch-with-cache')
      vi.mocked(cachedFetch).mockResolvedValue({
        data: { results: [] },
        source: 'arkham-re',
        cached: false,
        timestamp: Date.now(),
        ttl: 0,
      })

      await arkhamModule.fetch({ action: 'search', q: 'binance' })

      expect(cachedFetch).toHaveBeenCalledWith(
        'arkham-re',
        { action: 'search', q: 'binance' },
        expect.any(Number),
        expect.any(Function),
      )
    })
  })

  describe('fallbackFn()', () => {
    it('is a function', () => {
      expect(typeof arkhamModule.fallbackFn).toBe('function')
    })

    it('returns ModuleResult with seed data shape for known address', async () => {
      // Mock getEntityLabel to avoid DB call
      vi.mock('../ai-signals/entity-labels-seed', () => ({
        getEntityLabel: vi.fn().mockResolvedValue({ label: 'Binance', category: 'exchange', confidence: 0.95 }),
      }))

      // Re-import to pick up the mock
      const { default: mod } = await import('../onchain/arkham/entities')
      const result = await mod.fallbackFn!({ address: '0x123', chain: 'eth' })

      expect(result.data).toBeDefined()
      expect(result).toHaveProperty('source')
      expect(result.source).toContain('arkham-re')
      expect(result.source).toContain('seed')
      expect(result).toHaveProperty('cached')
      expect(result.cached).toBe(true)
    })

    it('returns Unknown label for unknown address', async () => {
      vi.mock('../ai-signals/entity-labels-seed', () => ({
        getEntityLabel: vi.fn().mockResolvedValue(undefined),
      }))

      const { default: mod } = await import('../onchain/arkham/entities')
      const result = await mod.fallbackFn!({ address: '0x999' })

      expect(result.data).toEqual({ label: 'Unknown', category: 'unknown' })
    })
  })
})
