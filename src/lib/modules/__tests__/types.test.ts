// ─────────────────────────────────────────────────────────────
// Module Type System Validation Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { TTL, getSourceTypeLabel } from '../types'
import type { SourceType, DataCategory } from '../types'

describe('Module Type System', () => {
  describe('TTL constants', () => {
    it('PRICE_DATA is reasonable (10-60s)', () => {
      expect(TTL.PRICE_DATA).toBeGreaterThanOrEqual(10_000)
      expect(TTL.PRICE_DATA).toBeLessThanOrEqual(60_000)
    })

    it('NEWS is reasonable (1-10min)', () => {
      expect(TTL.NEWS).toBeGreaterThanOrEqual(60_000)
      expect(TTL.NEWS).toBeLessThanOrEqual(600_000)
    })

    it('MACRO_DATA is 1 hour', () => {
      expect(TTL.MACRO_DATA).toBe(3_600_000)
    })

    it('RE_MULTIPLIER is 2-4x', () => {
      expect(TTL.RE_MULTIPLIER).toBeGreaterThanOrEqual(2)
      expect(TTL.RE_MULTIPLIER).toBeLessThanOrEqual(4)
    })

    it('DERIVATIVES is fast (15-60s)', () => {
      expect(TTL.DERIVATIVES).toBeGreaterThanOrEqual(15_000)
      expect(TTL.DERIVATIVES).toBeLessThanOrEqual(60_000)
    })
  })

  describe('getSourceTypeLabel()', () => {
    it('labels all source types', () => {
      const types: SourceType[] = ['public-api', 'public-rpc', 'oss-mirror', 're', 'derived']
      for (const t of types) {
        const label = getSourceTypeLabel(t)
        expect(label).toBeTruthy()
        expect(label.length).toBeGreaterThan(0)
      }
    })

    it('returns correct labels', () => {
      expect(getSourceTypeLabel('public-api')).toBe('Public API')
      expect(getSourceTypeLabel('public-rpc')).toBe('Public RPC')
      expect(getSourceTypeLabel('oss-mirror')).toBe('OSS Mirror')
      expect(getSourceTypeLabel('re')).toBe('Reverse-Engineered')
      expect(getSourceTypeLabel('derived')).toBe('Derived')
    })
  })

  describe('DataCategory coverage', () => {
    it('all expected categories exist as valid type', () => {
      const categories: DataCategory[] = [
        'onchain', 'market', 'defi', 'derivatives', 'macro',
        'equities', 'forex', 'commodities', 'news', 'sentiment',
        'prediction', 'ai-signals',
      ]
      // Just verify the array compiles — TypeScript enforces the union
      expect(categories).toHaveLength(12)
    })
  })
})
