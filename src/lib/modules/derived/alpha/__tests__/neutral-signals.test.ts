// Regression: neutral-direction signals (e.g. high-OI warning) must survive
// the composer. Previously applyCorrelationFilter killed every neutral signal
// (caps map has no 'neutral' key → ++undefined = NaN → NaN <= 5 is false),
// deduplicateAndConfirm required agree>=2 or confidence>=65, and
// calculateLevels returned null for neutral (level-less → dropped).
import { describe, it, expect } from 'vitest'
import { calculateLevels } from '@/lib/modules/derived/alpha/indicators'
import {
  applyCorrelationFilter,
  deduplicateAndConfirm,
} from '@/lib/modules/derived/alpha/signal-composer'
import type { AlphaSignal } from '@/lib/modules/derived/alpha/types'

function sig(over: Partial<AlphaSignal>): AlphaSignal {
  return {
    id: 't',
    symbol: 'BTC',
    direction: 'neutral',
    strength: 50,
    confidence: 45,
    sources: ['open-interest'],
    reasoning: 'test',
    timestamp: Date.now(),
    entry: 79000,
    tp1: 80000,
    tp2: 81000,
    tp3: 82000,
    sl: 78000,
    validPeriod: '24h',
    expiresAt: Date.now() + 86400000,
    ...over,
  }
}

describe('neutral signals survive composer', () => {
  it('correlation filter passes neutral through (own cap, not NaN-killed)', () => {
    const out = applyCorrelationFilter([sig({})], new Map())
    expect(out).toHaveLength(1)
  })

  it('dedup keeps a lone neutral signal with confidence >= 40', () => {
    const out = deduplicateAndConfirm([sig({})])
    expect(out).toHaveLength(1)
  })

  it('dedup still drops weak lone neutral (confidence < 40)', () => {
    const out = deduplicateAndConfirm([sig({ confidence: 35 })])
    expect(out).toHaveLength(0)
  })

  it('directional confirmation rules unchanged', () => {
    // lone directional low-confidence still needs agreement
    expect(deduplicateAndConfirm([sig({ direction: 'bullish', confidence: 50 })])).toHaveLength(0)
    // high-confidence directional passes alone
    expect(deduplicateAndConfirm([sig({ direction: 'bullish', confidence: 70 })])).toHaveLength(1)
  })

  it('calculateLevels returns two-sided range for neutral (not null)', () => {
    const lv = calculateLevels(79000, 1200, 'neutral', 'chop')
    expect(lv).not.toBeNull()
    expect(lv!.entry).toBe(79000)
    expect(lv!.tp1).toBeGreaterThan(79000)
    expect(lv!.sl).toBeLessThan(79000)
  })
})
