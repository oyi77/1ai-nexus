// ─────────────────────────────────────────────────────────────
// Module Interface Contract Tests
// Verifies ALL registered DataModule implementations satisfy the
// DataModule interface contract.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { registerAllModules } from '../index'

describe('Module Interface Contract', () => {
  const registry = registerAllModules()
  const modules = registry.getAll()

  it('has all expected modules registered', () => {
    // Expect the full set of modules (57+ across all categories)
    expect(modules.length).toBeGreaterThanOrEqual(50)
  })

  describe('common interface requirements', () => {
    const REQUIRED_KEYS = ['id', 'name', 'category', 'sourceType', 'provenance'] as const
    const PROVENANCE_KEYS = ['describesItself', 'fragility', 'lastVerified', 'toleratesAbsence'] as const

    for (const mod of modules) {
      describe(`module: ${mod.id}`, () => {
        it('has all required top-level properties', () => {
          for (const key of REQUIRED_KEYS) {
            expect(mod).toHaveProperty(key)
          }
        })

        it('has a valid id (non-empty string)', () => {
          expect(mod.id).toBeTruthy()
          expect(typeof mod.id).toBe('string')
        })

        it('has a valid name (non-empty string)', () => {
          expect(mod.name).toBeTruthy()
          expect(typeof mod.name).toBe('string')
        })

        it('has a valid category', () => {
          expect(mod.category).toBeTruthy()
          expect(typeof mod.category).toBe('string')
        })

        it('has a valid sourceType', () => {
          expect(mod.sourceType).toBeTruthy()
          const validTypes = ['public-api', 'public-rpc', 'oss-mirror', 're', 'derived']
          expect(validTypes).toContain(mod.sourceType)
        })

        it('has provenance with all required fields', () => {
          for (const key of PROVENANCE_KEYS) {
            expect(mod.provenance).toHaveProperty(key)
          }
          expect(typeof mod.provenance.describesItself).toBe('string')
          expect(mod.provenance.describesItself.length).toBeGreaterThan(0)
          expect(typeof mod.provenance.fragility).toBe('string')
          expect(typeof mod.provenance.lastVerified).toBe('string')
          expect(typeof mod.provenance.toleratesAbsence).toBe('boolean')
        })

        it('has isEnabled that returns boolean', () => {
          expect(typeof mod.isEnabled).toBe('function')
          const result = mod.isEnabled()
          expect(typeof result).toBe('boolean')
        })

        it('has healthCheck as a function', () => {
          expect(typeof mod.healthCheck).toBe('function')
        })

        it('has fetch as a function', () => {
          expect(typeof mod.fetch).toBe('function')
        })
      })
    }
  })

  describe('RE module requirements', () => {
    const reModules = modules.filter(m => m.sourceType === 're')

    it('has at least one RE module', () => {
      expect(reModules.length).toBeGreaterThan(0)
    })

    for (const mod of reModules) {
      describe(`RE module: ${mod.id}`, () => {
        it('has fallbackFn', () => {
          expect(mod.fallbackFn).toBeDefined()
          expect(typeof mod.fallbackFn).toBe('function')
        })

        it('has fragile or moderate fragility', () => {
          expect(['fragile', 'moderate']).toContain(mod.provenance.fragility)
        })

        it('has tolerable absence (toleratesAbsence === true)', () => {
          expect(mod.provenance.toleratesAbsence).toBe(true)
        })
      })
    }
  })

  describe('public-api module requirements', () => {
    const publicApiModules = modules.filter(m => m.sourceType === 'public-api')

    for (const mod of publicApiModules) {
      describe(`public-api module: ${mod.id}`, () => {
        it('may have stable or moderate fragility', () => {
          expect(['stable', 'moderate']).toContain(mod.provenance.fragility)
        })

        it('tolerates absence', () => {
          expect(mod.provenance.toleratesAbsence).toBe(true)
        })
      })
    }
  })
})
