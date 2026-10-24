// ─────────────────────────────────────────────────────────────
// strategy-backtest tests — verify candidate categorization, refusal
// tallying, hit compilation, and markdown reporting.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  categorizeMarketCap,
  categorizeLiquidity,
  tallyRefusals,
  compileBacktestReport,
  type BacktestCandidate,
} from '../strategy-backtest'
import type { StrategyIntakeResult } from '../strategy-intake'
import type { StrategyVerdict } from '../strategy-evaluator'
import { EMPTY_CONFLUENCE } from '../call-confluence'

describe('categorizeMarketCap', () => {
  it('correctly maps values to designated strategy bands and deadzones', () => {
    expect(categorizeMarketCap(null)).toBe('unmeasured')
    expect(categorizeMarketCap(0)).toBe('unmeasured')
    expect(categorizeMarketCap(-500)).toBe('unmeasured')
    expect(categorizeMarketCap(500_000)).toBe('under1M')
    expect(categorizeMarketCap(1_500_000)).toBe('band1M_2M')
    expect(categorizeMarketCap(3_500_000)).toBe('band2M_6M')
    expect(categorizeMarketCap(7_000_000)).toBe('band6M_8M')
    expect(categorizeMarketCap(10_000_000)).toBe('band8M_15M')
    expect(categorizeMarketCap(25_000_000)).toBe('band15M_45M')
    expect(categorizeMarketCap(60_000_000)).toBe('above45M')
  })
})

describe('categorizeLiquidity', () => {
  it('correctly bins liquidity into threshold tiers', () => {
    expect(categorizeLiquidity(null)).toBe('unmeasured')
    expect(categorizeLiquidity(0)).toBe('unmeasured')
    expect(categorizeLiquidity(5_000)).toBe('under10k')
    expect(categorizeLiquidity(25_000)).toBe('band10k_50k')
    expect(categorizeLiquidity(75_000)).toBe('band50k_100k')
    expect(categorizeLiquidity(150_000)).toBe('above100k')
  })
})

describe('tallyRefusals', () => {
  it('counts occurrences of failed rules from refusal strings', () => {
    const histogram: Record<string, number> = {}
    const refusals = [
      'Second Wave — mc-band: MC $1.2M vs $2.0M-$6.0M band',
      'Level Flip — mc-band: MC $1.2M vs $8.0M-$15.0M band',
      'Whale Comeback — liquidity-floor: $12k vs $50k floor',
      'Second Wave — higher-low: last low is lower',
    ]

    tallyRefusals(refusals, histogram)

    expect(histogram['mc-band']).toBe(2)
    expect(histogram['liquidity-floor']).toBe(1)
    expect(histogram['higher-low']).toBe(1)
  })
})

describe('compileBacktestReport', () => {
  it('aggregates hits, refusals, buckets, and generates formatted summary', () => {
    const candidates: BacktestCandidate[] = [
      {
        contract: 'TokenA111111111111111111111111111111111111',
        symbol: 'TKNA',
        chain: 'solana',
        marketCapUsd: 3_500_000,
        liquidityUsd: 80_000,
        volume24hUsd: 200_000,
      },
      {
        contract: 'TokenB111111111111111111111111111111111111',
        symbol: 'TKNB',
        chain: 'solana',
        marketCapUsd: 500_000,
        liquidityUsd: 8_000,
        volume24hUsd: 15_000,
      },
    ]

    const firedVerdict: StrategyVerdict = {
      strategy: 'second_wave',
      fired: true,
      confidence: 85,
      refs: [{ rule: 'mc-band', passed: true, detail: 'within band' }],
      entryUsd: 3_500_000,
      stopUsd: 2_900_000,
      targetUsd: 5_200_000,
      rr: 2.8,
    }

    const results: StrategyIntakeResult[] = [
      {
        contract: candidates[0].contract,
        fired: firedVerdict,
        verdicts: [firedVerdict],
        structure: null,
        seriesFailure: null,
        ladder: null,
        structureLines: ['base holding'],
        refusals: [],
        guardSource: 'tracked',
        confluence: {
          ...EMPTY_CONFLUENCE(candidates[0].contract),
          available: true,
          present: true,
          groups: ['CallAnalyser2', 'solearlytrending'],
          groupCount: 2,
          effectiveGroupCount: 2.5,
        },
        confluenceLine: '2 call groups',
        confluenceBar: { pass: true, detail: 'cleared bar' },
      },
      {
        contract: candidates[1].contract,
        fired: null,
        verdicts: [],
        structure: null,
        seriesFailure: null,
        ladder: null,
        structureLines: [],
        refusals: [
          'Second Wave — mc-band: below $2M floor',
          'Second Wave — liquidity-floor: below $50k',
        ],
        guardSource: null,
        confluence: EMPTY_CONFLUENCE(candidates[1].contract),
        confluenceLine: 'confluence unmeasured',
        confluenceBar: null,
      },
    ]

    const report = compileBacktestReport(candidates, results)

    expect(report.totalReplayed).toBe(2)
    expect(report.firedCount).toBe(1)
    expect(report.refusedCount).toBe(1)
    expect(report.hitRatePct).toBe(50)
    expect(report.hitsByStrategy.second_wave).toBe(1)
    expect(report.hitsByStrategy.level_flip).toBe(0)
    expect(report.hits.length).toBe(1)
    expect(report.hits[0].symbol).toBe('TKNA')
    expect(report.hits[0].rr).toBe(2.8)
    expect(report.hits[0].confluenceGroups).toEqual(['CallAnalyser2', 'solearlytrending'])

    expect(report.marketCapBuckets.band2M_6M).toBe(1)
    expect(report.marketCapBuckets.under1M).toBe(1)
    expect(report.liquidityBuckets.band50k_100k).toBe(1)
    expect(report.liquidityBuckets.under10k).toBe(1)

    expect(report.refusalHistogram['mc-band']).toBe(1)
    expect(report.refusalHistogram['liquidity-floor']).toBe(1)

    expect(report.summaryMarkdown).toContain('**Total Candidates Replayed:** 2')
    expect(report.summaryMarkdown).toContain('**Setups Fired:** 1 (50.0% hit rate)')
    expect(report.summaryMarkdown).toContain('**Second Wave ($2M–$6M):** 1')
  })
})
