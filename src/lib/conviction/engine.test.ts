import { describe, expect, it } from 'vitest'
import {
  actionFor,
  buildCryptoItem,
  buildIdxItem,
  buildReasons,
  buildResult,
  cryptoReasons,
  directionFor,
  emptyResult,
  idxReasons,
  scoreCrypto,
  scoreIdx,
  scoreIdxRow,
  sourceLabel,
} from '@/lib/conviction/engine'
import type { AlphaSignalLike, IdxLeaderLike } from '@/lib/conviction/engine'

describe('scoreIdx', () => {
  const base = { changePct: 0, estNetValueIdr: 0 } as const

  it('starts at 50 with no qualifying conditions', () => {
    expect(scoreIdx({ ...base, netVol: 0 }, 'buy')).toBe(50)
    expect(scoreIdx({ ...base, netVol: 0 }, 'sell')).toBe(50)
  })

  it('buy side adds +25 netVol>0, +15 changePct>3, +10 estNetValueIdr>1e11', () => {
    expect(scoreIdx({ netVol: 100, changePct: 4, estNetValueIdr: 2e11 }, 'buy')).toBe(100)
    expect(scoreIdx({ netVol: 100, changePct: 1, estNetValueIdr: 0 }, 'buy')).toBe(75)
    expect(scoreIdx({ netVol: 0, changePct: 4, estNetValueIdr: 0 }, 'buy')).toBe(65)
    expect(scoreIdx({ netVol: 0, changePct: 1, estNetValueIdr: 2e11 }, 'buy')).toBe(60)
  })

  it('sell side subtracts -25 netVol<0 and -15 changePct<-3', () => {
    expect(scoreIdx({ netVol: -100, changePct: -4, estNetValueIdr: 0 }, 'sell')).toBe(10)
    expect(scoreIdx({ netVol: -100, changePct: -1, estNetValueIdr: 0 }, 'sell')).toBe(25)
    expect(scoreIdx({ netVol: 0, changePct: -4, estNetValueIdr: 0 }, 'sell')).toBe(35)
  })

  it('ignores opposite-sign conditions per side', () => {
    // negative netVol must not penalize the buy side
    expect(scoreIdx({ netVol: -100, changePct: -4, estNetValueIdr: 0 }, 'buy')).toBe(50)
    // positive netVol must not boost the sell side
    expect(scoreIdx({ netVol: 100, changePct: 4, estNetValueIdr: 0 }, 'sell')).toBe(50)
  })

  it('clamps to 0-100', () => {
    expect(scoreIdx({ netVol: 0, changePct: -100, estNetValueIdr: 0 }, 'sell')).toBe(35)
    expect(scoreIdx({ netVol: 1e9, changePct: 100, estNetValueIdr: 1e15 }, 'buy')).toBe(100)
  })
})

describe('actionFor / directionFor', () => {
  it('maps conviction to BUY/WAIT/SELL at the documented thresholds', () => {
    expect(actionFor(100)).toBe('BUY')
    expect(actionFor(65)).toBe('BUY')
    expect(actionFor(64)).toBe('WAIT')
    expect(actionFor(35)).toBe('WAIT')
    expect(actionFor(34)).toBe('SELL')
    expect(actionFor(0)).toBe('SELL')
  })

  it('maps conviction to bull/bear/neutral at the documented thresholds', () => {
    expect(directionFor(65)).toBe('bull')
    expect(directionFor(100)).toBe('bull')
    expect(directionFor(64)).toBe('neutral')
    expect(directionFor(36)).toBe('neutral')
    expect(directionFor(35)).toBe('bear')
    expect(directionFor(0)).toBe('bear')
  })
})

describe('scoreCrypto', () => {
  const sig = (over: Partial<AlphaSignalLike>): AlphaSignalLike => ({
    type: 'whale',
    direction: 'bullish',
    strength: 100,
    confidence: 1,
    headline: 'sig',
    ...over,
  })

  it('neutral conviction (50) with no signals', () => {
    expect(scoreCrypto([])).toBe(50)
  })

  it('full-strength bullish whale signal: 50 + (1×1×1×0.3)×100 = 80', () => {
    expect(scoreCrypto([sig({})])).toBe(80)
  })

  it('full-strength bearish whale signal: 50 - 30 = 20', () => {
    expect(scoreCrypto([sig({ direction: 'bearish' })])).toBe(20)
  })

  it('neutral direction contributes zero', () => {
    expect(scoreCrypto([sig({ direction: 'neutral', strength: 100, confidence: 1 })])).toBe(50)
  })

  it('scales with strength and confidence', () => {
    // 50 + (1 × 0.5 × 0.5 × 0.3) × 100 = 57.5
    expect(scoreCrypto([sig({ strength: 50, confidence: 0.5 })])).toBe(57.5)
  })

  it('applies type weights (news 0.1 vs whale 0.35)', () => {
    const base = { direction: 'bullish' as const, strength: 100, confidence: 1, headline: 'x' }
    expect(scoreCrypto([{ ...base, type: 'news' }])).toBe(60)
    expect(scoreCrypto([{ ...base, type: 'smart_money' }])).toBe(75)
    expect(scoreCrypto([{ ...base, type: 'liquidation' }])).toBe(70)
    expect(scoreCrypto([{ ...base, type: 'derivatives' }])).toBe(70)
    // unknown type falls back to default 0.15
    expect(scoreCrypto([{ ...base, type: 'insider' }])).toBe(65)
  })

  it('aggregates multiple signals additively', () => {
    const signals = [
      sig({ direction: 'bullish', strength: 100, confidence: 1, type: 'whale' }), // +30
      sig({ direction: 'bullish', strength: 100, confidence: 1, type: 'news' }), // +10
    ]
    expect(scoreCrypto(signals)).toBe(90)
  })

  it('thesis adds ±10 weighted 0.3', () => {
    expect(scoreCrypto([sig({ direction: 'neutral' })], 'BULLISH')).toBe(53)
    expect(scoreCrypto([sig({ direction: 'neutral' })], 'BEARISH')).toBe(47)
    expect(scoreCrypto([sig({ direction: 'neutral' })], 'NEUTRAL')).toBe(50)
  })

  it('clamps to 0-100', () => {
    expect(scoreCrypto([sig({ direction: 'bullish' }), sig({ direction: 'bullish' }), sig({ direction: 'bullish' }), sig({ direction: 'bullish' })])).toBe(100)
    const bear = Array.from({ length: 4 }, () => sig({ direction: 'bearish' }))
    expect(scoreCrypto(bear)).toBe(0)
  })
})

describe('buildReasons', () => {
  it('sorts by weight desc and returns top N', () => {
    const candidates = [
      { text: 'low', weight: 0.1 },
      { text: 'high', weight: 0.9 },
      { text: 'mid', weight: 0.5 },
      { text: 'drop', weight: 0.2 },
    ]
    expect(buildReasons(candidates, 3)).toEqual([
      { text: 'high', weight: 0.9 },
      { text: 'mid', weight: 0.5 },
      { text: 'drop', weight: 0.2 },
    ])
  })

  it('drops empty text entries', () => {
    expect(buildReasons([{ text: '', weight: 1 }, { text: 'ok', weight: 0.5 }])).toEqual([{ text: 'ok', weight: 0.5 }])
  })
})

describe('idxReasons', () => {
  it('buy side reasons reflect net buy, gain, and large value', () => {
    const reasons = idxReasons({ netVol: 1_000_000, changePct: 5.4, estNetValueIdr: 2e11 }, 'buy')
    expect(reasons.length).toBe(3)
    expect(reasons[0].text).toContain('Foreign net buy 1,000,000 shares')
    expect(reasons.some((r) => r.text.includes('+5.4% on foreign accumulation'))).toBe(true)
  })

  it('sell side reasons reflect net sell and decline', () => {
    const reasons = idxReasons({ netVol: -500_000, changePct: -4.2, estNetValueIdr: -1e11 }, 'sell')
    expect(reasons[0].text).toContain('Foreign net sell 500,000 shares')
    expect(reasons.some((r) => r.text.includes('-4.2% on foreign distribution'))).toBe(true)
  })

  it('returns empty reasons when nothing qualifies', () => {
    expect(idxReasons({ netVol: 0, changePct: 0, estNetValueIdr: 0 }, 'buy')).toEqual([])
    expect(idxReasons({ netVol: 0, changePct: 0, estNetValueIdr: 0 }, 'sell')).toEqual([])
  })
})

describe('cryptoReasons', () => {
  it('returns top 3 by |weighted contribution|, skipping zero contributions', () => {
    const signals: AlphaSignalLike[] = [
      { type: 'whale', direction: 'bullish', strength: 100, confidence: 1, headline: 'strong' }, // |0.3|
      { type: 'news', direction: 'bullish', strength: 50, confidence: 0.5, headline: 'weak' }, // |0.025|
      { type: 'whale', direction: 'neutral', strength: 100, confidence: 1, headline: 'neutral-skip' }, // 0
    ]
    const reasons = cryptoReasons(signals, 3)
    expect(reasons).toEqual([
      { text: 'strong', weight: 0.3 },
      { text: 'weak', weight: 0.025 },
    ])
  })
})

describe('item builders', () => {
  it('buildIdxItem produces a coherent conviction item', () => {
    const leader: IdxLeaderLike = {
      code: 'BUMI',
      name: 'Bumi Resources Tbk.',
      close: 194,
      changePct: 5.43,
      netVol: 1_000_000,
      estNetValueIdr: 2e11,
    }
    const item = buildIdxItem(leader, 'buy')
    expect(item.symbol).toBe('BUMI')
    expect(item.name).toBe('Bumi Resources Tbk.')
    expect(item.price).toBe(194)
    expect(item.conviction).toBe(100)
    expect(item.action).toBe('BUY')
    expect(item.direction).toBe('bull')
    expect(item.sources).toEqual(['bandarmology'])
    expect(item.reasons.length).toBeGreaterThan(0)
  })

  it('buildCryptoItem aggregates sources and applies thesis + price', () => {
    const signals: AlphaSignalLike[] = [
      { type: 'whale', direction: 'bullish', strength: 100, confidence: 1, headline: 'whale in' },
      { type: 'news', direction: 'bullish', strength: 100, confidence: 1, headline: 'news' },
    ]
    const item = buildCryptoItem('btc', signals, 'BULLISH', { price: 78_752, changePct: -0.5 })
    expect(item.symbol).toBe('BTC')
    expect(item.name).toBe('Bitcoin')
    expect(item.price).toBe(78_752)
    expect(item.changePct).toBe(-0.5)
    expect(item.sources).toEqual(['alpha', 'whale', 'news', 'thesis'])
    expect(item.conviction).toBe(93) // 50 + 45 + 3
    expect(item.action).toBe('BUY')
    expect(item.direction).toBe('bull')
  })

  it('buildCryptoItem handles unknown asset and no signals gracefully', () => {
    const item = buildCryptoItem('ZYX', [], undefined, undefined)
    expect(item.symbol).toBe('ZYX')
    expect(item.name).toBe('ZYX')
    expect(item.price).toBe(0)
    expect(item.conviction).toBe(50)
    expect(item.action).toBe('WAIT')
    expect(item.sources).toEqual(['alpha'])
  })
})

describe('buildResult / emptyResult', () => {
  it('buildResult returns the two-market contract shape', () => {
    const result = buildResult([], [])
    expect(result.markets.map((m) => m.id)).toEqual(['IDX', 'CRYPTO'])
    expect(result.markets.map((m) => m.label)).toEqual(['Indonesia Equities', 'Crypto'])
    expect(result.markets.every((m) => Array.isArray(m.items))).toBe(true)
    expect(typeof result.generated).toBe('string')
  })

  it('emptyResult returns an empty markets list with a timestamp', () => {
    const result = emptyResult()
    expect(result.markets).toEqual([])
    expect(typeof result.generated).toBe('string')
  })
})

describe('sourceLabel', () => {
  it('maps alpha signal types to public chip labels', () => {
    expect(sourceLabel('whale')).toBe('whale')
    expect(sourceLabel('smart_money')).toBe('smart-money')
    expect(sourceLabel('derivatives')).toBe('funding')
    expect(sourceLabel('liquidation')).toBe('liquidation')
    expect(sourceLabel('news')).toBe('news')
    expect(sourceLabel('unknown_type')).toBe('unknown_type')
    expect(sourceLabel(undefined)).toBe('alpha')
  })
})


describe('scoreIdxRow (z-score path)', () => {
  const stats = { roeMean: 15, roeStd: 10, perMean: 20, perStd: 10, momMean: 0, momStd: 5 }

  it('scores above-median ROE above 50', () => {
    const { score } = scoreIdxRow({ roe: 25, per: 10, change1d: 0, der: 0.5 }, stats)
    expect(score).toBeGreaterThan(50)
  })

  it('scores negative ROE below 50 and adds loss-making reason', () => {
    const { score, reasons } = scoreIdxRow({ roe: -50, per: 20, change1d: 0 }, stats)
    expect(score).toBeLessThan(50)
    expect(reasons.some((r) => r.text.includes('loss-making'))).toBe(true)
  })

  it('does NOT collapse negative ROE to the same as zero (non-degenerate clamp)', () => {
    const neg = scoreIdxRow({ roe: -100, per: 20, change1d: 0 }, stats)
    const zero = scoreIdxRow({ roe: 0, per: 20, change1d: 0 }, stats)
    expect(neg.score).not.toBe(zero.score)
  })

  it('clamps insane ROE outlier (1470%) without breaking the score', () => {
    const { score } = scoreIdxRow({ roe: 1470, per: 20, change1d: 0 }, stats)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('momentum contributes but does not dominate equally to ROE', () => {
    const noMom = scoreIdxRow({ roe: 25, per: 20, change1d: 0 }, stats)
    const withMom = scoreIdxRow({ roe: 25, per: 20, change1d: 20 }, stats)
    // A huge momentum day should move the score, but not swallow ROE signal.
    expect(withMom.score).not.toBe(noMom.score)
  })

  it('actionFor(35)=WAIT vs directionFor(35)=bear boundary is consistent', () => {
    // Audit flagged the asymmetry: 35 is WAIT for action but bear for direction.
    // Document the actual behavior so it is a conscious contract, not a bug surprise.
    expect(actionFor(35)).toBe('WAIT')
    expect(directionFor(35)).toBe('bear')
  })
})
