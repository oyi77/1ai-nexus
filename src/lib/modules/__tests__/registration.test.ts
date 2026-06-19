// ─────────────────────────────────────────────────────────────
// Module Registration Integration Tests
// Verifies all modules register correctly and have valid structure
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { registerAllModules } from '../index'


describe('Module Registration Integration', () => {
  it('registers all modules without errors', () => {
    const registry = registerAllModules()
    const all = registry.getAll()
    expect(all.length).toBeGreaterThanOrEqual(30)
  })

  it('every module has a unique id', () => {
    const registry = registerAllModules()
    const ids = registry.getAll().map(m => m.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('every module has required fields', () => {
    const registry = registerAllModules()
    for (const mod of registry.getAll()) {
      expect(mod.id).toBeTruthy()
      expect(mod.name).toBeTruthy()
      expect(mod.category).toBeTruthy()
      expect(mod.sourceType).toBeTruthy()
      expect(mod.provenance).toBeDefined()
      expect(mod.provenance.describesItself).toBeTruthy()
      expect(mod.provenance.fragility).toBeTruthy()
      expect(mod.provenance.lastVerified).toBeTruthy()
      expect(typeof mod.isEnabled).toBe('function')
      expect(typeof mod.healthCheck).toBe('function')
      expect(typeof mod.fetch).toBe('function')
    }
  })

  it('every re module has a fallbackFn', () => {
    const registry = registerAllModules()
    const reModules = registry.getAll().filter(m => m.sourceType === 're')
    expect(reModules.length).toBeGreaterThan(0)
    for (const mod of reModules) {
      expect(mod.fallbackFn).toBeDefined()
      expect(typeof mod.fallbackFn).toBe('function')
    }
  })

  it('every re module has fragility: fragile or moderate', () => {
    const registry = registerAllModules()
    const reModules = registry.getAll().filter(m => m.sourceType === 're')
    for (const mod of reModules) {
      expect(['fragile', 'moderate']).toContain(mod.provenance.fragility)
    }
  })

  it('every module tolerates absence', () => {
    const registry = registerAllModules()
    for (const mod of registry.getAll()) {
      expect(mod.provenance.toleratesAbsence).toBe(true)
    }
  })

  it('modules span all expected categories', () => {
    const registry = registerAllModules()
    const categories = new Set(registry.getAll().map(m => m.category))
    expect(categories.has('onchain')).toBe(true)
    expect(categories.has('market')).toBe(true)
    expect(categories.has('macro')).toBe(true)
    expect(categories.has('news')).toBe(true)
    expect(categories.has('sentiment')).toBe(true)
    expect(categories.has('defi')).toBe(true)
    expect(categories.has('derivatives')).toBe(true)
    expect(categories.has('prediction')).toBe(true)
  })

  it('modules span expected source types', () => {
    const registry = registerAllModules()
    const types = new Set(registry.getAll().map(m => m.sourceType))
    expect(types.has('public-api')).toBe(true)
    expect(types.has('re')).toBe(true)
    expect(types.has('derived')).toBe(true)
    expect(types.has('oss-mirror')).toBe(true)
  })

  it('getModuleStatus returns valid status for all modules', () => {
    const registry = registerAllModules()
    const statuses = registry.getModuleStatus()
    expect(statuses.length).toBe(registry.getAll().length)
    for (const s of statuses) {
      expect(s.id).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(['active', 'degraded', 'offline']).toContain(s.status)
      expect(s.sourceType).toBeTruthy()
    }
  })
})
