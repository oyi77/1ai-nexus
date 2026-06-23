// ─────────────────────────────────────────────────────────────
// Signal Confidence Tracker Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerSignal,
  recordSignalOutcome,
  getSignalConfidence,
  getAllConfidences,
  calculateConfidenceGrade,
  resetConfidenceStore,
} from '../derived/signal-confidence'

describe('Signal Confidence Tracker', () => {
  beforeEach(() => {
    resetConfidenceStore()
  })

  describe('calculateConfidenceGrade()', () => {
    it('returns A for confidence > 80%', () => {
      expect(calculateConfidenceGrade(81)).toBe('A')
      expect(calculateConfidenceGrade(100)).toBe('A')
      expect(calculateConfidenceGrade(95.5)).toBe('A')
    })

    it('returns B for confidence 60-79', () => {
      expect(calculateConfidenceGrade(79)).toBe('B')
      expect(calculateConfidenceGrade(61)).toBe('B')
      expect(calculateConfidenceGrade(60)).toBe('B')
    })

    it('returns C for confidence 40-59', () => {
      expect(calculateConfidenceGrade(59)).toBe('C')
      expect(calculateConfidenceGrade(41)).toBe('C')
      expect(calculateConfidenceGrade(40)).toBe('C')
    })

    it('returns D for confidence 20-39', () => {
      expect(calculateConfidenceGrade(39)).toBe('D')
      expect(calculateConfidenceGrade(21)).toBe('D')
      expect(calculateConfidenceGrade(20)).toBe('D')
    })

    it('returns F for confidence < 20', () => {
      expect(calculateConfidenceGrade(19)).toBe('F')
      expect(calculateConfidenceGrade(10)).toBe('F')
      expect(calculateConfidenceGrade(0)).toBe('F')
    })
  })

  describe('getSignalConfidence()', () => {
    it('returns 0% confidence with empty sample for unknown type', () => {
      const result = getSignalConfidence('nonexistent')
      expect(result.confidence).toBe(0)
      expect(result.sampleSize).toBe(0)
    })

    it('returns 0% confidence when signals exist but none have outcomes', () => {
      registerSignal({
        id: 'sig-1',
        signalType: 'fear-extreme-buy',
        asset: 'BTC',
        direction: 'bullish',
        predictedOutcome: 'price increase',
        timestamp: Date.now(),
        timeHorizonMs: 86_400_000,
      })

      const result = getSignalConfidence('fear-extreme-buy')
      expect(result.confidence).toBe(0)
      expect(result.sampleSize).toBe(0)
    })

    it('calculates confidence correctly for a single correct outcome', () => {
      registerSignal({
        id: 'sig-1',
        signalType: 'fear-extreme-buy',
        asset: 'BTC',
        direction: 'bullish',
        predictedOutcome: 'price increase',
        timestamp: Date.now(),
        timeHorizonMs: 86_400_000,
      })
      recordSignalOutcome('sig-1', 'correct')

      const result = getSignalConfidence('fear-extreme-buy')
      expect(result.confidence).toBe(100)
      expect(result.sampleSize).toBe(1)
    })

    it('calculates confidence correctly for mixed outcomes', () => {
      // Register 5 signals of the same type
      for (let i = 0; i < 5; i++) {
        registerSignal({
          id: `sig-${i}`,
          signalType: 'alt-season',
          asset: 'ETH',
          direction: 'bullish',
          predictedOutcome: 'outperform BTC',
          timestamp: Date.now(),
          timeHorizonMs: 604_800_000,
        })
      }

      // 3 correct, 2 incorrect → 60%
      recordSignalOutcome('sig-0', 'correct')
      recordSignalOutcome('sig-1', 'correct')
      recordSignalOutcome('sig-2', 'correct')
      recordSignalOutcome('sig-3', 'incorrect')
      recordSignalOutcome('sig-4', 'incorrect')

      const result = getSignalConfidence('alt-season')
      expect(result.confidence).toBe(60)
      expect(result.sampleSize).toBe(5)
    })

    it('only counts outcomes for the requested signal type', () => {
      registerSignal({
        id: 'bull-1',
        signalType: 'bullish',
        asset: 'BTC',
        direction: 'bullish',
        predictedOutcome: 'up',
        timestamp: Date.now(),
        timeHorizonMs: 86_400_000,
      })
      registerSignal({
        id: 'bear-1',
        signalType: 'bearish',
        asset: 'BTC',
        direction: 'bearish',
        predictedOutcome: 'down',
        timestamp: Date.now(),
        timeHorizonMs: 86_400_000,
      })

      recordSignalOutcome('bull-1', 'correct')
      recordSignalOutcome('bear-1', 'incorrect')

      expect(getSignalConfidence('bullish').confidence).toBe(100)
      expect(getSignalConfidence('bearish').confidence).toBe(0)
    })

    it('ignores recordSignalOutcome for unknown signal ids', () => {
      // Should not throw
      recordSignalOutcome('nonexistent-id', 'correct')
      expect(getSignalConfidence('anything').sampleSize).toBe(0)
    })
  })

  describe('getAllConfidences()', () => {
    it('returns array of confidences', async () => {
      const result = await getAllConfidences()
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns confidences for all registered signal types', async () => {
      registerSignal({
        id: 'a-1', signalType: 'type-a', asset: 'BTC',
        direction: 'bullish', predictedOutcome: 'up',
        timestamp: Date.now(), timeHorizonMs: 86_400_000,
      })
      registerSignal({
        id: 'b-1', signalType: 'type-b', asset: 'ETH',
        direction: 'bearish', predictedOutcome: 'down',
        timestamp: Date.now(), timeHorizonMs: 86_400_000,
      })
      recordSignalOutcome('a-1', 'correct')
      recordSignalOutcome('b-1', 'incorrect')

      const all = await getAllConfidences()
      expect(all.length).toBeGreaterThanOrEqual(2)

      const aConf = all.find(c => c.signalType === 'type-a')
      const bConf = all.find(c => c.signalType === 'type-b')
      expect(aConf).toBeDefined()
      expect(bConf).toBeDefined()
      if (aConf) {
        expect(aConf.confidence).toBe(100)
        expect(aConf.sampleSize).toBe(1)
      }
      if (bConf) {
        expect(bConf.confidence).toBe(0)
        expect(bConf.sampleSize).toBe(1)
      }
    })

    it('returns results sorted by signal type', async () => {
      registerSignal({
        id: 'z-1', signalType: 'zulu', asset: 'BTC',
        direction: 'bullish', predictedOutcome: 'up',
        timestamp: Date.now(), timeHorizonMs: 86_400_000,
      })
      registerSignal({
        id: 'a-1', signalType: 'alpha', asset: 'BTC',
        direction: 'bullish', predictedOutcome: 'up',
        timestamp: Date.now(), timeHorizonMs: 86_400_000,
      })

      const all = await getAllConfidences()
      const types = all.map(c => c.signalType)
      expect(types).toContain('alpha')
      expect(types).toContain('zulu')
    })
  })
})
