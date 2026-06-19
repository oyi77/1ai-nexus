// ─────────────────────────────────────────────────────────────
// Entity Label Seed Data Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { ENTITY_SEEDS, getEntityLabel, getEntitiesByCategory } from '../ai-signals/entity-labels-seed'

describe('Entity Label Seed Data', () => {
  describe('ENTITY_SEEDS', () => {
    it('contains at least 20 seeded entities', () => {
      expect(ENTITY_SEEDS.length).toBeGreaterThanOrEqual(20)
    })

    it('all entities have required fields', () => {
      for (const entity of ENTITY_SEEDS) {
        expect(entity.address).toBeTruthy()
        expect(entity.chain).toBeTruthy()
        expect(entity.label).toBeTruthy()
        expect(entity.category).toBeTruthy()
        expect(entity.confidence).toBeGreaterThan(0)
        expect(entity.confidence).toBeLessThanOrEqual(1)
      }
    })

    it('all addresses are valid format', () => {
      for (const entity of ENTITY_SEEDS) {
        if (entity.chain === 'eth') {
          expect(entity.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
        }
      }
    })

    it('categories are valid', () => {
      const validCategories = ['vc', 'cex', 'whale', 'defi', 'protocol', 'dao', 'bridge', 'mev', 'nft', 'miner']
      for (const entity of ENTITY_SEEDS) {
        expect(validCategories).toContain(entity.category)
      }
    })

    it('no duplicate address+chain combinations', () => {
      const seen = new Set<string>()
      for (const entity of ENTITY_SEEDS) {
        const key = `${entity.chain}:${entity.address.toLowerCase()}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    })
  })

  describe('getEntityLabel()', () => {
    it('finds Binance Hot Wallet by address', () => {
      const entity = getEntityLabel('0x28C6c06298d514Db089934071355E5743bf21d60', 'eth')
      expect(entity).toBeDefined()
      expect(entity?.label).toBe('Binance Hot Wallet')
      expect(entity?.category).toBe('cex')
    })

    it('is case-insensitive for addresses', () => {
      const entity = getEntityLabel('0x28c6c06298d514db089934071355e5743bf21d60', 'eth')
      expect(entity).toBeDefined()
      expect(entity?.label).toBe('Binance Hot Wallet')
    })

    it('returns undefined for unknown address', () => {
      const entity = getEntityLabel('0x1234567890abcdef1234567890abcdef12345679', 'eth')
      expect(entity).toBeUndefined()
    })

    it('filters by chain', () => {
      const ethEntity = getEntityLabel('0x28C6c06298d514Db089934071355E5743bf21d60', 'eth')
      expect(ethEntity).toBeDefined()

      const solEntity = getEntityLabel('0x28C6c06298d514Db089934071355E5743bf21d60', 'sol')
      expect(solEntity).toBeUndefined()
    })
  })

  describe('getEntitiesByCategory()', () => {
    it('returns all CEX entities', () => {
      const cex = getEntitiesByCategory('cex')
      expect(cex.length).toBeGreaterThanOrEqual(3)
      for (const e of cex) expect(e.category).toBe('cex')
    })

    it('returns all VC entities', () => {
      const vc = getEntitiesByCategory('vc')
      expect(vc.length).toBeGreaterThanOrEqual(1)
      for (const e of vc) expect(e.category).toBe('vc')
    })

    it('returns empty for unknown category', () => {
      expect(getEntitiesByCategory('nonexistent')).toHaveLength(0)
    })
  })
})
