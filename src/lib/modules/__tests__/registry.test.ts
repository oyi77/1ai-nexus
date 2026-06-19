// ─────────────────────────────────────────────────────────────
// Module Registry Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { ModuleRegistry } from '../registry'
import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'

function createMockModule(overrides: Partial<DataModule> = {}): DataModule {
  return {
    id: 'test-module',
    name: 'Test Module',
    category: 'market',
    sourceType: 'public-api',
    provenance: {
      describesItself: 'Test module for unit tests',
      fragility: 'stable',
      lastVerified: '2026-06-19',
      toleratesAbsence: true,
    },
    isEnabled: () => true,
    async healthCheck(): Promise<ModuleHealth> {
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    },
    async fetch<T>(_params: FetchParams): Promise<ModuleResult<T>> {
      return { data: { hello: 'world' } as T, source: 'test', cached: false, timestamp: Date.now(), ttl: 10_000 }
    },
    ...overrides,
  }
}

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry

  beforeEach(() => {
    registry = new ModuleRegistry()
  })

  describe('register()', () => {
    it('registers a module', () => {
      const mod = createMockModule()
      registry.register(mod)
      expect(registry.get('test-module')).toBe(mod)
    })

    it('overwrites when registering same id twice', () => {
      const mod1 = createMockModule({ name: 'First' })
      const mod2 = createMockModule({ name: 'Second' })
      registry.register(mod1)
      registry.register(mod2)
      expect(registry.get('test-module')?.name).toBe('Second')
    })
  })

  describe('registerAll()', () => {
    it('registers multiple modules at once', () => {
      const mods = [
        createMockModule({ id: 'a', name: 'A' }),
        createMockModule({ id: 'b', name: 'B' }),
        createMockModule({ id: 'c', name: 'C' }),
      ]
      registry.registerAll(mods)
      expect(registry.getAll()).toHaveLength(3)
    })
  })

  describe('getEnabled()', () => {
    it('returns only enabled modules', () => {
      registry.registerAll([
        createMockModule({ id: 'enabled', isEnabled: () => true }),
        createMockModule({ id: 'disabled', isEnabled: () => false }),
      ])
      expect(registry.getEnabled()).toHaveLength(1)
      expect(registry.getEnabled()[0].id).toBe('enabled')
    })

    it('filters by category', () => {
      registry.registerAll([
        createMockModule({ id: 'a', category: 'market' }),
        createMockModule({ id: 'b', category: 'macro' }),
        createMockModule({ id: 'c', category: 'market' }),
      ])
      expect(registry.getEnabled('market')).toHaveLength(2)
      expect(registry.getEnabled('macro')).toHaveLength(1)
    })
  })

  describe('getByCategory()', () => {
    it('returns all modules in category including disabled', () => {
      registry.registerAll([
        createMockModule({ id: 'a', category: 'news', isEnabled: () => true }),
        createMockModule({ id: 'b', category: 'news', isEnabled: () => false }),
      ])
      expect(registry.getByCategory('news')).toHaveLength(2)
    })
  })

  describe('fetchOne()', () => {
    it('fetches from a registered module', async () => {
      registry.register(createMockModule())
      const result = await registry.fetchOne('test-module')
      expect(result.data).toEqual({ hello: 'world' })
      expect(result.source).toBe('test')
    })

    it('throws for unknown module', async () => {
      await expect(registry.fetchOne('nonexistent')).rejects.toThrow('Module not found: nonexistent')
    })

    it('throws for disabled module', async () => {
      registry.register(createMockModule({ isEnabled: () => false }))
      await expect(registry.fetchOne('test-module')).rejects.toThrow('Module disabled: test-module')
    })

    it('records success on successful fetch', async () => {
      registry.register(createMockModule())
      await registry.fetchOne('test-module')
      const status = registry.getModuleStatus()
      expect(status[0].failureCount).toBe(0)
    })

    it('records failure and uses fallback on fetch error', async () => {
      const fallbackData = { fallback: true }
      registry.register(createMockModule({
        async fetch() { throw new Error('Network error') },
        async fallbackFn<T>(): Promise<ModuleResult<T>> {
          return { data: fallbackData as T, source: 'fallback', cached: true, timestamp: Date.now(), ttl: 10_000 }
        },
      }))

      const result = await registry.fetchOne('test-module')
      expect(result.data).toEqual(fallbackData)
      expect(result.source).toContain('fallback')
    })

    it('re-throws when no fallback is available', async () => {
      registry.register(createMockModule({
        async fetch() { throw new Error('Network error') },
      }))

      await expect(registry.fetchOne('test-module')).rejects.toThrow('Network error')
    })
  })

  describe('fetchAll()', () => {
    it('fetches from all enabled modules in a category', async () => {
      registry.registerAll([
        createMockModule({ id: 'a', category: 'market' }),
        createMockModule({ id: 'b', category: 'market' }),
        createMockModule({ id: 'c', category: 'macro' }),
      ])

      const results = await registry.fetchAll('market')
      expect(results).toHaveLength(2)
    })

    it('skips failed modules gracefully', async () => {
      registry.registerAll([
        createMockModule({ id: 'ok', category: 'market' }),
        createMockModule({
          id: 'fail',
          category: 'market',
          async fetch() { throw new Error('fail') },
        }),
      ])

      const results = await registry.fetchAll('market')
      expect(results).toHaveLength(1)
      expect(results[0].source).toBe('test')
    })
  })

  describe('getModuleStatus()', () => {
    it('returns status for all registered modules', () => {
      registry.registerAll([
        createMockModule({ id: 'a', name: 'Alpha' }),
        createMockModule({ id: 'b', name: 'Beta' }),
      ])

      const statuses = registry.getModuleStatus()
      expect(statuses).toHaveLength(2)
      expect(statuses.map(s => s.id)).toContain('a')
      expect(statuses.map(s => s.id)).toContain('b')
    })

    it('includes sourceType and provenance', () => {
      registry.register(createMockModule())
      const status = registry.getModuleStatus()[0]
      expect(status.sourceType).toBe('public-api')
      expect(status.provenance.fragility).toBe('stable')
    })
  })
})
