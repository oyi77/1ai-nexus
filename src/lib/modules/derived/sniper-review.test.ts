// ─────────────────────────────────────────────────────────────
// Sniper review digest unit tests (pure selection, no Telegram).
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { pickReviewCandidates, REVIEW_VOLMC_FLOOR } from './sniper-review'
import type { SniperScanDecision } from './sniper-scan'

function decision(over: Partial<SniperScanDecision>): SniperScanDecision {
  return {
    status: 'REJECT',
    rationale: '',
    rejections: ['Top 10 hold 99% (ceiling 30%)'],
    warnings: [],
    metrics: {
      stage: 'new-pair',
      ageMinutes: 8,
      ageLabel: '8 Menit',
      stageLabel: 'New Pair',
      volMcRatio: 0,
      requiredRatio: 2,
      devPercent: 0,
      sniperPercent: 0,
      bundlerPercent: 0,
      insiderPercent: 0,
      top10Percent: 99,
      clusterPercent: 0,
      avgPnlPercent: null,
      pnlAssessment: 'neutral',
    },
    alert: '',
    contract: 'c111',
    ticker: 'TEST',
    deduped: false,
    delivered: false,
    auditsUsed: ['rugcheck'],
    tier: 'REJECT',
    tierReasons: [],
    tierMissing: [],
    smartMoneyBuyers: 0,
    smartMoneyStrongest: null,
    smartMoneySource: 'wallet-tracer:gmgn-holders',
    ...over,
  }
}

function vol(contract: string, volMcRatio: number): SniperScanDecision {
  return decision({
    contract,
    metrics: { ...decision({}).metrics, volMcRatio },
  })
}

describe('pickReviewCandidates', () => {
  it('keeps REJECTs at or above the floor, hottest first', () => {
    const picks = pickReviewCandidates([
      vol('a', REVIEW_VOLMC_FLOOR - 0.01),
      vol('b', REVIEW_VOLMC_FLOOR),
      vol('c', REVIEW_VOLMC_FLOOR + 2),
    ])
    expect(picks.map((p) => p.contract)).toEqual(['c', 'b'])
  })

  it('never picks a non-REJECT (a SIGNAL must not double-send as review)', () => {
    const picks = pickReviewCandidates([
      decision({ contract: 's', status: 'SIGNAL', tier: 'WATCHLIST' }),
    ])
    expect(picks).toHaveLength(0)
  })

  it('never picks a deduped row', () => {
    const picks = pickReviewCandidates([decision({ contract: 'd', deduped: true })])
    expect(picks).toHaveLength(0)
  })

  it('rejects NaN ratios (uncomputable momentum is not a near-miss)', () => {
    const picks = pickReviewCandidates([vol('n', NaN)])
    expect(picks).toHaveLength(0)
  })
})
