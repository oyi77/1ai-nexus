// ─────────────────────────────────────────────────────────────
// On-Chain Macro Metrics Tests
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildOnchainMacro,
  getLatestMacro,
  resetMacroCache,
} from '../derived/onchain-macro'

// We test buildOnchainMacro (pure) + caching logic of getLatestMacro.
// The async fetchOnchainMacro hits external APIs so we leave integration
// testing for E2E; here we verify the computation layer.

describe('On-Chain Macro Metrics', () => {
  beforeEach(() => {
    resetMacroCache()
  })

  // ─── buildOnchainMacro ──────────────────────────────────────

  describe('buildOnchainMacro()', () => {
    it('computes MVRV as marketCap / realizedCap', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 50_000_000_000, priceChange7d: 5 },
        1_000_000_000_000,
      )
      expect(result.mvrv).toBeCloseTo(2.0, 2)
    })

    it('returns MVRV = 0 when realizedCap is zero', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 50_000_000_000, priceChange7d: 5 },
        0,
      )
      expect(result.mvrv).toBe(0)
    })

    it('computes SOPR proxy as 1 + priceChange7d/100', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 50_000_000_000, priceChange7d: 8.5 },
        1_000_000_000_000,
      )
      // 1 + 8.5/100 = 1.085
      expect(result.sopr).toBeCloseTo(1.085, 3)
    })

    it('SOPR > 1 when priceChange7d is positive', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 50_000_000_000, priceChange7d: 3.2 },
        1_000_000_000_000,
      )
      expect(result.sopr).toBeGreaterThan(1)
    })

    it('SOPR < 1 when priceChange7d is negative', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 50_000_000_000, priceChange7d: -12.3 },
        1_000_000_000_000,
      )
      expect(result.sopr).toBeLessThan(1)
      expect(result.sopr).toBeCloseTo(0.877, 3)
    })

    it('SOPR = 1 when priceChange7d is zero', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 50_000_000_000, priceChange7d: 0 },
        1_000_000_000_000,
      )
      expect(result.sopr).toBe(1)
    })

    it('computes NVT as marketCap / volume24h', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 40_000_000_000, priceChange7d: 5 },
        1_000_000_000_000,
      )
      expect(result.nvt).toBeCloseTo(50, 0)
    })

    it('returns NVT = 0 when volume is zero', () => {
      const result = buildOnchainMacro(
        { price: 100_000, marketCap: 2_000_000_000_000, volume24h: 0, priceChange7d: 5 },
        1_000_000_000_000,
      )
      expect(result.nvt).toBe(0)
    })

    it('populates all fields in the result', () => {
      const result = buildOnchainMacro(
        { price: 60_000, marketCap: 1_200_000_000_000, volume24h: 30_000_000_000, priceChange7d: 2.5 },
        600_000_000_000,
      )
      expect(result.mvrv).toBeGreaterThan(0)
      expect(result.sopr).toBeGreaterThan(0)
      expect(result.nvt).toBeGreaterThan(0)
      expect(result.realizedCap).toBe(600_000_000_000)
      expect(result.marketCap).toBe(1_200_000_000_000)
      expect(result.timestamp).toBeInstanceOf(Date)
    })
  })

  // ─── Caching ────────────────────────────────────────────────

  describe('getLatestMacro()', () => {
    it('returns null before any fetch', () => {
      expect(getLatestMacro()).toBeNull()
    })

    it('returns null when cache is empty', () => {
      resetMacroCache()
      expect(getLatestMacro()).toBeNull()
    })
  })

  // ─── Edge cases ─────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles extremely large market cap without overflow', () => {
      const result = buildOnchainMacro(
        { price: 1_000_000, marketCap: 21_000_000_000_000_000, volume24h: 1_000_000_000_000, priceChange7d: 10 },
        10_000_000_000_000_000,
      )
      expect(Number.isFinite(result.mvrv)).toBe(true)
      expect(Number.isFinite(result.nvt)).toBe(true)
    })

    it('handles tiny volume gracefully', () => {
      const result = buildOnchainMacro(
        { price: 30_000, marketCap: 600_000_000_000, volume24h: 0.01, priceChange7d: 0 },
        300_000_000_000,
      )
      expect(result.nvt).toBeGreaterThan(0)
      expect(Number.isFinite(result.nvt)).toBe(true)
    })

    it('handles zero realized cap', () => {
      const result = buildOnchainMacro(
        { price: 30_000, marketCap: 600_000_000_000, volume24h: 10_000_000_000, priceChange7d: 5 },
        0,
      )
      expect(result.mvrv).toBe(0)
    })

    it('large negative price change still produces valid SOPR', () => {
      const result = buildOnchainMacro(
        { price: 15_000, marketCap: 300_000_000_000, volume24h: 20_000_000_000, priceChange7d: -50 },
        400_000_000_000,
      )
      expect(result.sopr).toBeCloseTo(0.5, 1)
      expect(Number.isFinite(result.sopr)).toBe(true)
    })
  })
})
