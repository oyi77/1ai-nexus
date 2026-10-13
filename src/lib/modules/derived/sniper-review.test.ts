// ─────────────────────────────────────────────────────────────
// Sniper review digest unit tests (pure selection, no Telegram).
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  pickReviewCandidates,
  selectFreshForReview,
  REVIEW_VOLMC_FLOOR,
  assessReview,
  renderReviewDigestForTest,
} from './sniper-review'
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
    discoveryCategory: 'NEW_PAIRS',
    discoveryEvidence: [],
    market: { marketCapUsd: 50_000, liquidityUsd: 12_000, volume5mUsd: 4_000, priceUsd: 0.0005 },
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

describe('selectFreshForReview (Phase 7 re-review rule)', () => {
  it('sends unseen contracts and suppresses seen ones', () => {
    const rows = [vol('a', 3), vol('b', 3)]
    expect(selectFreshForReview(rows, {}).map((d) => d.contract)).toEqual(['a', 'b'])
    expect(selectFreshForReview(rows, { a: 1 }).map((d) => d.contract)).toEqual(['b'])
  })

  it('re-opens a seen contract when force names it', () => {
    const rows = [vol('a', 3)]
    const out = selectFreshForReview(rows, { a: Date.now() }, new Set(['a']))
    expect(out.map((d) => d.contract)).toEqual(['a'])
  })
})


// ─────────────────────────────────────────────────────────────
// TAHAP 7 fixtures: render pipeline must survive the operator's
// edge cases and never emit an unparseable HTML message.
// ─────────────────────────────────────────────────────────────

/** Every `<` in a rendered message must open a real HTML tag or be `&lt;`. */
function assertHtmlSafe(msgs: string[]): void {
  for (const m of msgs) {
    expect(m.length).toBeLessThanOrEqual(4096)
    for (let i = 0; i < m.length; i++) {
      if (m[i] !== '<') continue
      const rest = m.slice(i)
      const escaped = m.slice(Math.max(0, i - 3), i).includes('&lt;')
      const tag = /^<\/?(b|i|code|u|s|a)(\s|>)/.test(rest)
      expect(escaped || tag, `raw < at offset ${i}: ${JSON.stringify(rest.slice(0, 24))}`).toBe(true)
    }
  }
}

describe('renderReviewDigestForTest (TAHAP 7 fixtures)', () => {
  it('multi-reject: renders every rejection, none silently dropped', () => {
    const d = decision({
      contract: 'multi1',
      rejections: [
        'Dev holds 22.5% — beyond hard ceiling',
        'Snipers hold 22.5% (ceiling 6%)',
        'Top 10 hold 72.9% (ceiling 30%)',
        'Dead momentum: 5m vol/mcap 0.10x < required 4x',
      ],
      metrics: { ...decision({}).metrics, volMcRatio: 1.5, top10Percent: 72.9 },
    })
    const msgs = renderReviewDigestForTest([d])
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('SEMUA ALASAN PENOLAKAN (4)')
    assertHtmlSafe(msgs)
  })

  it('UNKNOWN: unverified metrics render as ❓, never as 0', () => {
    const d = decision({
      contract: 'unk1',
      rejections: ['Dev holding unproven — cannot confirm'],
      metrics: {
        ...decision({}).metrics,
        devPercent: null,
        insiderPercent: null,
        clusterPercent: null,
        volMcRatio: 3,
      },
      market: { marketCapUsd: 50_000, liquidityUsd: null, volume5mUsd: null, priceUsd: null },
    })
    expect(assessReview(d).finalStatus).toBe('UNKNOWN')
    const msgs = renderReviewDigestForTest([d])
    expect(msgs[0]).toContain('❓ belum terverifikasi')
    assertHtmlSafe(msgs)
  })

  it('duplicate: a deduped row is never rendered into the digest', () => {
    const rows = [
      vol('dup1', 3),
      decision({ contract: 'dup1', deduped: true, metrics: { ...decision({}).metrics, volMcRatio: 3 } }),
    ]
    const msgs = renderReviewDigestForTest(rows)
    expect(msgs[0]).toContain('Kandidat: 1 ditampilkan')
    assertHtmlSafe(msgs)
  })

  it('bonding: POST_MIGRATED category is labelled, not shown as NEW_PAIRS', () => {
    const d = vol('bond1', 2.5)
    d.discoveryCategory = 'POST_MIGRATED'
    const msgs = renderReviewDigestForTest([d])
    expect(msgs[0]).toContain('POST_MIGRATED')
    assertHtmlSafe(msgs)
  })

  it('whale: a WHALE_AND_SMART_MONEY holder renders as detected, not absent', () => {
    const d = decision({
      contract: 'whale1',
      metrics: { ...decision({}).metrics, volMcRatio: 3 },
      smartMoneyBuyers: 3,
      smartMoneyStrongest: 'WHALE_AND_SMART_MONEY',
    })
    const msgs = renderReviewDigestForTest([d])
    expect(msgs[0]).toContain('WHALE_AND_SMART_MONEY')
    expect(msgs[0]).not.toContain('tidak ada bukti whale terklasifikasi')
    assertHtmlSafe(msgs)
  })

  it('E2E payload: a 30-block flood splits, every chunk HTML-safe and ≤4096', () => {
    const flood = Array.from({ length: 30 }, (_, i) =>
      decision({
        contract: `flood${i}`,
        ticker: `T_${i}`,
        metrics: { ...decision({}).metrics, volMcRatio: 3 + i },
      }),
    )
    const msgs = renderReviewDigestForTest(flood)
    expect(msgs.length).toBeGreaterThan(1)
    assertHtmlSafe(msgs)
  })
})