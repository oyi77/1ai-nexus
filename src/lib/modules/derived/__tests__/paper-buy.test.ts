import { describe, it, expect } from 'vitest'
import {
  buildPaperPositions,
  renderPaperSummary,
  scoredHorizon,
  summarisePaperPositions,
  type PaperPosition,
} from '../paper-buy'
import type { SignalOutcome } from '../sniper-outcomes'

const T0 = '2026-10-12T00:00:00.000Z'
const DUE = '2026-10-13T00:00:00.000Z'

function signal(over: Partial<SignalOutcome> = {}): SignalOutcome {
  return {
    contract: 'mint111',
    ticker: 'TOK',
    tier: 'HIGH_CONVICTION',
    deliveredAt: T0,
    entryMarketCapUsd: 100_000,
    horizonHours: 24,
    dueAt: DUE,
    exitMarketCapUsd: null,
    returnPct: null,
    verdict: 'PENDING',
    scoredAt: null,
    ...over,
  }
}

function position(over: Partial<PaperPosition> = {}): PaperPosition {
  return {
    contract: 'mint111',
    ticker: 'TOK',
    tier: 'HIGH_CONVICTION',
    deliveredAt: T0,
    entryMarketCapUsd: 100_000,
    notionalUsd: 100,
    horizons: {
      h1: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
      h4: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
      h24: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
      d7: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
    },
    ...over,
  }
}

describe('buildPaperPositions — 24h PnL at a fixed notional', () => {
  it('a +100% TARGET doubles the notional: +$100 on $100', () => {
    const [p] = buildPaperPositions(
      [signal({ verdict: 'TARGET', exitMarketCapUsd: 200_000, returnPct: 1, scoredAt: DUE })],
      100,
    )
    expect(p.horizons.h24.verdict).toBe('TARGET')
    expect(p.horizons.h24.returnPct).toBeCloseTo(1, 9)
    expect(p.horizons.h24.pnlUsd).toBeCloseTo(100, 9)
    expect(p.horizons.h24.exitMarketCapUsd).toBe(200_000)
  })

  it('a -50% STOPPED loses half the notional: -$50 on $100', () => {
    const [p] = buildPaperPositions(
      [signal({ verdict: 'STOPPED', exitMarketCapUsd: 50_000, returnPct: -0.5, scoredAt: DUE })],
      100,
    )
    expect(p.horizons.h24.verdict).toBe('STOPPED')
    expect(p.horizons.h24.pnlUsd).toBeCloseTo(-50, 9)
  })

  it('a 0% FLAT breaks even: $0 PnL', () => {
    const [p] = buildPaperPositions(
      [signal({ verdict: 'FLAT', exitMarketCapUsd: 100_000, returnPct: 0, scoredAt: DUE })],
      100,
    )
    expect(p.horizons.h24.verdict).toBe('FLAT')
    expect(p.horizons.h24.pnlUsd).toBe(0)
  })

  it('PENDING and unproven-entry signals stay open positions with null PnL', () => {
    const pending = buildPaperPositions([signal()], 100)[0]
    expect(pending.horizons.h24.verdict).toBeNull()
    expect(pending.horizons.h24.pnlUsd).toBeNull()

    const unproven = buildPaperPositions(
      [signal({ entryMarketCapUsd: null, verdict: 'PENDING' })],
      100,
    )[0]
    expect(unproven.horizons.h24.pnlUsd).toBeNull()
    expect(scoredHorizon(unproven)).toBeNull()
  })

  it('UNPRICEABLE is terminal but never scored — open, not a loss', () => {
    const [p] = buildPaperPositions(
      [signal({ verdict: 'UNPRICEABLE', scoredAt: DUE })],
      100,
    )
    expect(scoredHorizon(p)).toBeNull()
    expect(summarisePaperPositions([p]).openPositions).toBe(1)
  })

  it('non-standard horizonHours carry no horizon data (never fabricated)', () => {
    const [p] = buildPaperPositions(
      [signal({ verdict: 'TARGET', exitMarketCapUsd: 200_000, returnPct: 1, scoredAt: DUE })],
      100,
    )
    // The scored horizon matches the logged horizonHours (24 → h24); the
    // other bars stay PENDING until the observer persists per-horizon data.
    expect(p.horizons.h1.verdict).toBeNull()
    expect(p.horizons.h4.verdict).toBeNull()
    expect(p.horizons.d7.verdict).toBeNull()
  })
})

describe('summarisePaperPositions — portfolio aggregate', () => {
  const closed = (verdict: 'TARGET' | 'STOPPED' | 'FLAT', ret: number, ticker = 'TOK'): PaperPosition =>
    position({
      ticker,
      horizons: {
        h1: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
        h4: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
        h24: {
          exitMarketCapUsd: 100_000 * (1 + ret),
          returnPct: ret,
          pnlUsd: 100 * ret,
          verdict,
        },
        d7: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
      },
    })

  it('mixed portfolio: totals, win rate and PnL are correct', () => {
    const summary = summarisePaperPositions([
      closed('TARGET', 1),
      closed('TARGET', 2, 'MOON'),
      closed('STOPPED', -0.5, 'RUG'),
      closed('FLAT', 0, 'MEH'),
      position({ ticker: 'OPEN' }),
    ])
    expect(summary.totalNotionalUsd).toBe(500)
    expect(summary.openPositions).toBe(1)
    expect(summary.closedPositions).toBe(4)
    expect(summary.wins).toBe(2)
    expect(summary.losses).toBe(1)
    expect(summary.flat).toBe(1)
    expect(summary.totalPnlUsd).toBeCloseTo(100 + 200 - 50 + 0, 9)
    expect(summary.winRatePct).toBeCloseTo(2 / 3 * 100, 9)
    expect(summary.avgReturnPct).toBeCloseTo((1 + 2 - 0.5 + 0) / 4, 9)
  })

  it('best/worst pick the extreme closed positions by returnPct', () => {
    const summary = summarisePaperPositions([
      closed('TARGET', 1, 'OK'),
      closed('TARGET', 3, 'MOON'),
      closed('STOPPED', -0.5, 'RUG'),
    ])
    expect(summary.best?.ticker).toBe('MOON')
    expect(summary.worst?.ticker).toBe('RUG')
  })

  it('all-open book: null rates, never 0% or fabricated losses', () => {
    const summary = summarisePaperPositions([position(), position({ ticker: 'OPEN2' })])
    expect(summary.openPositions).toBe(2)
    expect(summary.closedPositions).toBe(0)
    expect(summary.winRatePct).toBeNull()
    expect(summary.avgReturnPct).toBeNull()
    expect(summary.totalPnlUsd).toBe(0)
    expect(summary.best).toBeNull()
    expect(summary.worst).toBeNull()
  })
})

describe('renderPaperSummary — operator HTML block', () => {
  it('contains the header, footer and stays under 2000 chars', () => {
    const summary = summarisePaperPositions([
      position({
        ticker: 'MOON',
        horizons: {
          h1: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
          h4: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
          h24: { exitMarketCapUsd: 400_000, returnPct: 3, pnlUsd: 300, verdict: 'TARGET' },
          d7: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
        },
      }),
      position({ ticker: 'RUG' }),
    ])
    const text = renderPaperSummary(summary)
    expect(text).toContain('PAPER TRADING SUMMARY')
    expect(text).toContain('paper simulation')
    expect(text).toContain('MOON')
    expect(text.length).toBeLessThan(2000)
  })

  it('escapes dynamic text so data can never open an HTML entity', () => {
    const summary = summarisePaperPositions([
      position({
        ticker: '<img src=x>',
        horizons: {
          h1: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
          h4: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
          h24: { exitMarketCapUsd: 200_000, returnPct: 1, pnlUsd: 100, verdict: 'TARGET' },
          d7: { exitMarketCapUsd: null, returnPct: null, pnlUsd: null, verdict: null },
        },
      }),
    ])
    const text = renderPaperSummary(summary)
    expect(text).toContain('&lt;img')
    expect(text).not.toContain('<img')
  })

  it('empty signals render zeros and n/a — never NaN', () => {
    const text = renderPaperSummary(summarisePaperPositions([]))
    expect(text).toContain('PAPER TRADING SUMMARY')
    expect(text).toContain('n/a')
    expect(text).not.toContain('NaN')
    expect(text).toContain('$0.00')
  })
})
