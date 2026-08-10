// ─────────────────────────────────────────────────────────────
// Gate.io Performance RE Module Tests
// Tests run against real saved fixtures (no network); the fetch
// global is stubbed to serve the fixture payloads per URL.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import gateioModule, { type GateioPerformanceData } from '../derivatives/gateio/performance'
import { _clearCaches } from '../fetch-with-cache'

import profileFixture from './fixtures/gateio-profile.json'
import equityFixture from './fixtures/gateio-equity.json'
import marketsFixture from './fixtures/gateio-markets.json'
import tradesFixture from './fixtures/gateio-trades.json'

// Keep the module's lazy Redis client out of tests (memory cache only).
vi.mock('../../redis', () => ({
  getRedisClient: () => null,
}))

function stubGateioFixtures() {
  const f = vi.fn(async (input: unknown) => {
    const url = String(input)
    let body: unknown = profileFixture
    if (url.includes('/trading_view')) body = tradesFixture
    else if (url.includes('/profit_chart')) body = equityFixture
    else if (url.includes('/position_composition')) body = marketsFixture
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response
  })
  vi.stubGlobal('fetch', f)
  return f
}

describe('Gate.io Performance RE Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _clearCaches()
  })

  describe('module definition', () => {
    it('has correct id', () => {
      expect(gateioModule.id).toBe('gateio-performance')
    })

    it('has correct name', () => {
      expect(gateioModule.name).toBe('Gate.io Copy Leader Performance')
    })

    it('has correct category', () => {
      expect(gateioModule.category).toBe('derivatives')
    })

    it('has correct sourceType', () => {
      expect(gateioModule.sourceType).toBe('re')
    })

    it('has provenance with all required fields', () => {
      expect(gateioModule.provenance.describesItself).toBeTruthy()
      expect(typeof gateioModule.provenance.describesItself).toBe('string')
      expect(gateioModule.provenance.fragility).toBe('fragile')
      expect(gateioModule.provenance.lastVerified).toBe('2026-08-11')
      expect(gateioModule.provenance.toleratesAbsence).toBe(true)
      expect(gateioModule.provenance.upstreamProduct).toBe('gate.com copy-trading leader analytics')
      expect(gateioModule.provenance.discoveredVia).toBe('devtools-network-tab')
    })
  })

  describe('isEnabled()', () => {
    it('returns true', () => {
      expect(gateioModule.isEnabled()).toBe(true)
    })
  })

  describe('healthCheck()', () => {
    it('returns active health when fetch succeeds', async () => {
      stubGateioFixtures()
      const health = await gateioModule.healthCheck()
      expect(health.status).toBe('active')
      expect(health.lastChecked).toBeInstanceOf(Date)
      expect(health.lastSuccess).toBeInstanceOf(Date)
      expect(health.failureCount).toBe(0)
    })

    it('returns degraded health when fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Gate.io 403: https://www.gate.com/…')),
      )
      const health = await gateioModule.healthCheck()
      expect(health.status).toBe('degraded')
      expect(health.lastChecked).toBeInstanceOf(Date)
      expect(health.failureCount).toBe(1)
      expect(health.notes).toContain('403')
    })
  })

  describe('fetch()', () => {
    it('aggregates all four sections into normalized performance data', async () => {
      stubGateioFixtures()
      const result = await gateioModule.fetch<GateioPerformanceData>({ leaderId: 30809 })
      const d = result.data

      expect(result.source).toBe('gateio-performance')
      expect(result.cached).toBe(false)
      expect(result.ttl).toBe(90_000)

      // Profile
      expect(d.profile).not.toBeNull()
      expect(d.profile?.nickname).toBe('Maple 1008')
      expect(d.profile?.id).toBe(30809)
      expect(d.profile?.tier).toBe(7)
      expect(d.profile?.stats.tradeNum).toBe(199)
      expect(d.profile?.stats.winNum).toBe(191)
      expect(d.profile?.stats.lossNum).toBe(8)
      expect(d.profile?.stats.winRate).toBeCloseTo(191 / 199, 4)
      expect(d.profile?.stats.profit).toBeCloseTo(65214.29, 2)
      expect(d.profile?.stats.sharpRatio).toBeCloseTo(5.69, 2)
      expect(d.profile?.stats.followProfit).toBeCloseTo(332747.57, 2)
      expect(d.profile?.markets.length).toBeGreaterThan(0)
      const btc = d.profile?.markets.find((m) => m.symbol === 'BTC_USDT')
      expect(btc?.maxLeverage).toBe(20)

      // Equity curve
      expect(d.equity.length).toBeGreaterThan(0)
      expect(d.equity[0].profit).toBeCloseTo(3231.71, 2)
      expect(d.equity[0].timestamp).toBeGreaterThan(0)
      expect(d.equity[0]).toHaveProperty('liqTag')
      expect(d.equity[0]).toHaveProperty('resetTag')

      // Position concentration (percent preserved as 0..1 fraction)
      expect(d.markets.length).toBeGreaterThan(0)
      expect(d.markets[0].symbol).toBe('BTC_USDT')
      expect(d.markets[0].percent).toBeCloseTo(0.4284, 4)
      expect(d.markets[0].pnl).toBeCloseTo(16060.38, 2)

      // Recent trades
      expect(d.trades.length).toBeGreaterThan(0)
      expect(d.trades[0]).toHaveProperty('market')
      expect(d.trades[0].holdSeconds).toBeGreaterThan(0)
      expect(d.trades[0].timestamp).toBeGreaterThan(0)
      expect(typeof d.trades[0].profit).toBe('number')
    })

    it('keeps other sections populated when one section fails (no 502)', async () => {
      const f = stubGateioFixtures()
      f.mockImplementation(async (input: unknown) => {
        const url = String(input)
        if (url.includes('/position_composition') || url.includes('/trading_view')) {
          throw new Error('Gate.io 403: Akamai rate limit')
        }
        const body = url.includes('/profit_chart') ? equityFixture : profileFixture
        return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
      })

      const result = await gateioModule.fetch<GateioPerformanceData>({ leaderId: 99999 })
      const d = result.data

      expect(d.profile).not.toBeNull()
      expect(d.equity.length).toBeGreaterThan(0)
      expect(d.markets).toEqual([])
      expect(d.trades).toEqual([])
    })

    it('throws when leaderId is missing', async () => {
      await expect(gateioModule.fetch({})).rejects.toThrow('leaderId required')
    })
  })

  describe('fallbackFn()', () => {
    it('returns the empty performance shape with cached flag', async () => {
      const result = await gateioModule.fallbackFn<GateioPerformanceData>({ leaderId: 30809 })
      expect(result.data).toEqual({ profile: null, equity: [], markets: [], trades: [] })
      expect(result.source).toBe('gateio-performance (fallback)')
      expect(result.cached).toBe(true)
      expect(result.ttl).toBe(90_000)
    })
  })
})