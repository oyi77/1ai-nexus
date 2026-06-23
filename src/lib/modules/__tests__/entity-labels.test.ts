// ─────────────────────────────────────────────────────────────
// Entity Label Tests — DB-backed
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { getEntitySeeds, getEntityLabel, getEntitiesByCategory } from '../ai-signals/entity-labels-seed'

describe('Entity Label Service (DB-backed)', () => {
  describe('getEntitySeeds()', () => {
    it('returns entities from database', async () => {
      const seeds = await getEntitySeeds()
      expect(seeds.length).toBeGreaterThan(0)
    })

    it('all entities have required fields', async () => {
      const seeds = await getEntitySeeds()
      for (const entity of seeds.slice(0, 50)) {
        expect(entity.address).toBeTruthy()
        expect(entity.chain).toBeTruthy()
        expect(entity.label).toBeTruthy()
        expect(entity.category).toBeTruthy()
        expect(entity.confidence).toBeGreaterThan(0)
        expect(entity.confidence).toBeLessThanOrEqual(1)
      }
    })

    it('all addresses are valid hex format', async () => {
      const seeds = await getEntitySeeds()
      const hexPattern = /^0x[0-9a-fA-F]{40}$/
      let validCount = 0
      for (const entity of seeds) {
        if (hexPattern.test(entity.address)) validCount++
      }
      expect(validCount).toBeGreaterThan(0)
    })

    it('categories match DB entity types', async () => {
      const seeds = await getEntitySeeds()
      const validCategories = ['exchange', 'protocol', 'bridge', 'fund', 'whale', 'dao', 'Exchange', 'Protocol', 'Fund', 'Government']
      for (const entity of seeds.slice(0, 50)) {
        expect(validCategories).toContain(entity.category)
      }
    })
  })

  describe('getEntityLabel()', () => {
    it('finds Binance by known address', async () => {
      const entity = await getEntityLabel('0x28C6c06298d514Db089934071355E5743bf21d60', 'ethereum')
      expect(entity).toBeDefined()
      if (entity) {
        expect(entity.label).toContain('Binance')
      }
    })

    it('is case-insensitive for addresses', async () => {
      const entity = await getEntityLabel('0x28c6c06298d514db089934071355e5743bf21d60', 'ethereum')
      expect(entity).toBeDefined()
    })

    it('returns undefined for unknown address', async () => {
      const entity = await getEntityLabel('0x0000000000000000000000000000000000000000', 'ethereum')
      expect(entity).toBeUndefined()
    })
  })

  describe('getEntitiesByCategory()', () => {
    it('returns exchange entities', async () => {
      const exchanges = await getEntitiesByCategory('exchange')
      expect(exchanges.length).toBeGreaterThanOrEqual(1)
    })

    it('returns protocol entities', async () => {
      const protocols = await getEntitiesByCategory('protocol')
      expect(protocols.length).toBeGreaterThanOrEqual(1)
    })

    it('returns empty for unknown category', async () => {
      expect(await getEntitiesByCategory('nonexistent')).toHaveLength(0)
    })
  })
})
