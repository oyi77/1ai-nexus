// ─────────────────────────────────────────────────────────────
// Health Tracking Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { recordSuccess, recordFailure, getModuleHealth, getAllHealth, isModuleDegraded, resetHealth } from '../health'
import type { DataModule } from '../types'

function createMockModule(id = 'test-mod'): DataModule {
  return {
    id,
    name: 'Test',
    category: 'market',
    sourceType: 'public-api',
    provenance: {
      describesItself: 'test',
      fragility: 'stable',
      lastVerified: '2026-06-19',
      toleratesAbsence: true,
    },
    isEnabled: () => true,
    async healthCheck() { return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 } },
    async fetch<T>() { return { data: {} as T, source: 'test', cached: false, timestamp: Date.now(), ttl: 0 } },
  }
}

describe('Module Health Tracking', () => {
  beforeEach(() => {
    resetHealth('test-mod')
    resetHealth('re-mod')
  })

  describe('recordSuccess()', () => {
    it('records a successful fetch', () => {
      const mod = createMockModule()
      recordSuccess(mod)
      const health = getModuleHealth('test-mod')
      expect(health?.status).toBe('active')
      expect(health?.failureCount).toBe(0)
      expect(health?.lastSuccess).toBeDefined()
    })

    it('resets failure count on success', () => {
      const mod = createMockModule()
      recordFailure(mod, new Error('fail 1'))
      recordFailure(mod, new Error('fail 2'))
      expect(getModuleHealth('test-mod')?.failureCount).toBe(2)

      recordSuccess(mod)
      expect(getModuleHealth('test-mod')?.failureCount).toBe(0)
    })
  })

  describe('recordFailure()', () => {
    it('increments failure count', () => {
      const mod = createMockModule()
      recordFailure(mod, new Error('fail'))
      expect(getModuleHealth('test-mod')?.failureCount).toBe(1)

      recordFailure(mod, new Error('fail again'))
      expect(getModuleHealth('test-mod')?.failureCount).toBe(2)
    })

    it('marks module as degraded after 3 failures', () => {
      const mod = createMockModule()
      recordFailure(mod, new Error('1'))
      recordFailure(mod, new Error('2'))
      expect(getModuleHealth('test-mod')?.status).toBe('active')

      recordFailure(mod, new Error('3'))
      expect(getModuleHealth('test-mod')?.status).toBe('degraded')
    })

    it('adds RE source change note for re modules after threshold', () => {
      const mod = createMockModule('re-mod')
      mod.sourceType = 're'
      recordFailure(mod, new Error('1'))
      recordFailure(mod, new Error('2'))
      recordFailure(mod, new Error('3'))
      expect(getModuleHealth('re-mod')?.notes).toBe('RE source change suspected')
    })

    it('does not add RE note for non-re modules', () => {
      const mod = createMockModule()
      recordFailure(mod, new Error('1'))
      recordFailure(mod, new Error('2'))
      recordFailure(mod, new Error('3'))
      expect(getModuleHealth('test-mod')?.notes).toBeUndefined()
    })
  })

  describe('isModuleDegraded()', () => {
    it('returns false for healthy module', () => {
      const mod = createMockModule()
      recordSuccess(mod)
      expect(isModuleDegraded('test-mod')).toBe(false)
    })

    it('returns true for degraded module', () => {
      const mod = createMockModule()
      for (let i = 0; i < 3; i++) recordFailure(mod, new Error(`${i}`))
      expect(isModuleDegraded('test-mod')).toBe(true)
    })
  })

  describe('getAllHealth()', () => {
    it('returns all tracked modules', () => {
      recordSuccess(createMockModule('a'))
      recordSuccess(createMockModule('b'))
      const all = getAllHealth()
      expect(all.length).toBeGreaterThanOrEqual(2)
    })
  })
})
