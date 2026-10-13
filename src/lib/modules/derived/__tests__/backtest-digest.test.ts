import { describe, expect, it } from 'vitest'
import { buildBacktestDigest, type BacktestReport } from '../backtest-digest'

function report(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    evaluated: 10,
    priced: 8,
    summary: {
      totalEvaluated: 10,
      totalPriced: 8,
      winRate: 0.25,
      stopRate: 0.125,
      avgReturnPct: -3.2,
      byStatus: {
        REJECT: { count: 4, priced: 3, targetRate: 0.3333 },
        WATCHLIST: { count: 3, priced: 2, targetRate: 0.5 },
        SIGNAL: { count: 3, priced: 3, targetRate: 0 },
      },
    },
    ...overrides,
  }
}

describe('buildBacktestDigest', () => {
  it('returns non-null HTML when priced > 0', () => {
    const digest = buildBacktestDigest(report())

    expect(digest).not.toBeNull()
    expect(digest).toContain('📊 <b>AUDIT BACKTEST</b>')
    expect(digest).toContain('Win rate: 25.0%')
    expect(digest).toContain('Avg return: -3.2%')
    expect(digest).toContain('shadow/paper analytics')
  })

  it('returns null when priced is 0', () => {
    expect(buildBacktestDigest(report({ priced: 0, summary: { totalPriced: 0 } }))).toBeNull()
  })

  it('returns null when summary is missing', () => {
    expect(buildBacktestDigest({ evaluated: 5, priced: 3 })).toBeNull()
  })

  it('formats n/a for null rates', () => {
    const digest = buildBacktestDigest(
      report({
        summary: {
          totalPriced: 8,
          winRate: null,
          stopRate: null,
          avgReturnPct: null,
          byStatus: {},
        },
      }),
    )

    expect(digest).toContain('Win rate: n/a')
    expect(digest).toContain('Stop rate: n/a')
    expect(digest).toContain('Avg return: n/a')
  })

  it('includes one line per status bucket', () => {
    const digest = buildBacktestDigest(report())

    expect(digest).toContain('<b>REJECT</b>: 3 priced')
    expect(digest).toContain('<b>WATCHLIST</b>: 2 priced')
    expect(digest).toContain('<b>SIGNAL</b>: 3 priced')
  })

  it('HTML-escapes dynamic status text', () => {
    const digest = buildBacktestDigest(
      report({
        summary: {
          totalPriced: 8,
          byStatus: {
            '<SIGNAL>&MORE': { priced: 2, targetRate: 0.5 },
          },
        },
      }),
    )

    expect(digest).toContain('<b>&lt;SIGNAL&gt;&amp;MORE</b>: 2 priced')
    expect(digest).not.toContain('<b><SIGNAL>')
  })
})
