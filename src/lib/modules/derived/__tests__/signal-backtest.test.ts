import { describe, it, expect } from 'vitest'
import {
  priceTrade,
  classifyTrade,
  barCovering,
  summariseDemoBacktest,
  runDemoPortfolio,
  DEMO_BACKTEST_DEFAULTS,
  type DeliveredSignal,
  type DemoTrade,
} from '@/lib/modules/derived/signal-backtest'
import type { OhlcvBar } from '@/lib/modules/derived/historical-price'

const SIGNAL: DeliveredSignal = { contract: 'MintA', at: '2026-10-01T00:00:00.000Z' }
const T0 = Date.parse(SIGNAL.at)
const HOUR = 3_600_000

/** Bars at 0h, +1h, +4h, +24h, +168h relative to the signal. */
function bars(prices: number[]): OhlcvBar[] {
  const offsets = [0, 1, 4, 24, 168]
  return prices.map((close, i) => ({
    time: (T0 + offsets[i] * HOUR) / 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }))
}

describe('priceTrade', () => {
  it('opens at the bar at the signal and closes at the horizon bar', () => {
    const trade = priceTrade(SIGNAL, 'h4', bars([1, 1, 2, 3, 4]), T0 + 200 * HOUR)
    expect(trade.entryPriceUsd).toBe(1)
    expect(trade.exitPriceUsd).toBe(2)
    expect(trade.returnPct).toBeCloseTo(1, 10)
  })

  it('returns PENDING when the horizon has not elapsed yet (observable, not yet)', () => {
    const trade = priceTrade(SIGNAL, 'd7', bars([1, 1, 1, 1, 1]), T0 + 24 * HOUR)
    expect(trade.returnPct).toBeNull()
    expect(trade.verdict).toBe('PENDING')
  })

  it('returns UNPRICEABLE when the series does not cover the horizon', () => {
    // only two bars: nothing at/after +4h
    const short = bars([1, 2]).slice(0, 2)
    const trade = priceTrade(SIGNAL, 'h4', short, T0 + 200 * HOUR)
    expect(trade.verdict).toBe('UNPRICEABLE')
    expect(trade.returnPct).toBeNull()
  })

  it('never invents a return from a zero/absent entry price', () => {
    const zero = bars([0, 1, 2, 3, 4])
    expect(priceTrade(SIGNAL, 'h4', zero, T0 + 200 * HOUR).returnPct).toBeNull()
    expect(priceTrade(SIGNAL, 'h4', [], T0 + 200 * HOUR).returnPct).toBeNull()
  })

  it('treats an unparseable signal time as UNPRICEABLE', () => {
    const bad = priceTrade({ contract: 'X', at: 'not-a-date' }, 'h1', bars([1, 2, 3, 4, 5]), T0)
    expect(bad.verdict).toBe('UNPRICEABLE')
  })

  it('measures a loss as a loss', () => {
    const trade = priceTrade(SIGNAL, 'h24', bars([2, 2, 2, 1, 1]), T0 + 200 * HOUR)
    expect(trade.returnPct).toBeCloseTo(-0.5, 10)
  })
})

describe('barCovering', () => {
  const series = bars([1, 2, 3, 4, 5]) // bars at 0h, +1h, +4h, +24h, +168h

  it('returns the bar covering a signal inside that hour', () => {
    // 30 minutes into the first hour → that bar's close is the entry price
    expect(barCovering(series, T0 + 30 * 60_000)?.close).toBe(1)
  })

  it('returns the bar starting exactly at the signal', () => {
    expect(barCovering(series, T0)?.close).toBe(1)
    expect(barCovering(series, T0 + 2 * HOUR)?.close).toBe(2)
  })

  it('returns null before the first bar exists', () => {
    expect(barCovering(series, T0 - HOUR)).toBeNull()
  })

  it('returns the last bar for a timestamp past the series', () => {
    expect(barCovering(series, T0 + 1000 * HOUR)?.close).toBe(5)
  })
})

describe('classifyTrade', () => {
  const cfg = DEMO_BACKTEST_DEFAULTS

  it('classifies a large gain as TARGET and a large loss as STOPPED', () => {
    expect(classifyTrade({ ...tradeOf(0.6), verdict: 'FLAT' }, cfg).verdict).toBe('TARGET')
    expect(classifyTrade({ ...tradeOf(-0.4), verdict: 'FLAT' }, cfg).verdict).toBe('STOPPED')
  })

  it('reserves FLAT for a move inside the flat band, WIN above it, LOSS below it', () => {
    expect(classifyTrade({ ...tradeOf(0.02), verdict: 'FLAT' }, cfg).verdict).toBe('FLAT')
    expect(classifyTrade({ ...tradeOf(-0.03), verdict: 'FLAT' }, cfg).verdict).toBe('FLAT')
    expect(classifyTrade({ ...tradeOf(0), verdict: 'FLAT' }, cfg).verdict).toBe('FLAT')
    expect(classifyTrade({ ...tradeOf(0.2), verdict: 'FLAT' }, cfg).verdict).toBe('WIN')
    expect(classifyTrade({ ...tradeOf(-0.2), verdict: 'FLAT' }, cfg).verdict).toBe('LOSS')
  })

  it('treats a move exactly at the flat band as real: +band is WIN, -band is LOSS', () => {
    const cfg = { ...DEMO_BACKTEST_DEFAULTS, flatBandPct: 0.1, targetPct: 0.5, stopPct: 0.35 }
    expect(classifyTrade({ ...tradeOf(0.1), verdict: 'FLAT' }, cfg).verdict).toBe('WIN')
    expect(classifyTrade({ ...tradeOf(-0.1), verdict: 'FLAT' }, cfg).verdict).toBe('LOSS')
    expect(classifyTrade({ ...tradeOf(0.0999), verdict: 'FLAT' }, cfg).verdict).toBe('FLAT')
    expect(classifyTrade({ ...tradeOf(-0.0999), verdict: 'FLAT' }, cfg).verdict).toBe('FLAT')
  })

  it('leaves an unpriced trade untouched', () => {
    const t: DemoTrade = { ...tradeOf(0), returnPct: null, verdict: 'UNPRICEABLE' }
    expect(classifyTrade(t, cfg).verdict).toBe('UNPRICEABLE')
  })
})

function tradeOf(ret: number, contract = 'MintA'): DemoTrade {
  return {
    contract,
    signalAt: SIGNAL.at,
    horizon: 'h4',
    entryPriceUsd: 1,
    exitPriceUsd: 1 + ret,
    returnPct: ret,
    verdict: 'FLAT',
  }
}

describe('summariseDemoBacktest', () => {
  it('reports null rates when nothing was priced, never 0%', () => {
    const summary = summariseDemoBacktest([
      { ...tradeOf(0), returnPct: null, verdict: 'UNPRICEABLE' },
    ])
    expect(summary.priced).toBe(0)
    expect(summary.unpriceable).toBe(1)
    expect(summary.winRatePct).toBeNull()
    expect(summary.avgReturnPct).toBeNull()
    expect(summary.medianReturnPct).toBeNull()
  })

  it('computes win rate over decided trades and keeps flats out of it', () => {
    const summary = summariseDemoBacktest([
      { ...tradeOf(0.8), verdict: 'TARGET' },
      { ...tradeOf(-0.5), verdict: 'STOPPED' },
      { ...tradeOf(0.01), verdict: 'FLAT' },
    ])
    expect(summary.targets).toBe(1)
    expect(summary.stops).toBe(1)
    expect(summary.flats).toBe(1)
    expect(summary.winRatePct).toBe(50)
    expect(summary.avgReturnPct).toBeCloseTo((0.8 - 0.5 + 0.01) / 3 * 100, 6)
    expect(summary.medianReturnPct).toBeCloseTo(1, 6)
  })
})

describe('runDemoPortfolio', () => {
  const cfg = { startingSol: 10, solPriceUsd: 150, maxPositionPct: 0.1, feePct: 0.005 }
  const FEE_FACTOR = (1 - cfg.feePct) ** 2

  it('sizes each position from current equity and compounds gains', () => {
    const result = runDemoPortfolio(
      [
        { ...tradeOf(1, 'MintA'), signalAt: '2026-10-01T00:00:00Z', verdict: 'TARGET' },
        { ...tradeOf(1, 'MintB'), signalAt: '2026-10-02T00:00:00Z', verdict: 'TARGET' },
      ],
      cfg,
    )
    expect(result.startingUsd).toBe(1500)
    // first: 10% of 1500 = 150, gross +100% net of both fee legs
    expect(result.positions[0].notionalUsd).toBeCloseTo(150, 6)
    expect(result.positions[0].pnlUsd).toBeCloseTo(150 * (2 * FEE_FACTOR - 1), 6)
    // equity grew, so the second position is > 150
    expect(result.positions[1].notionalUsd).toBeGreaterThan(150)
    expect(result.endingUsd).toBeGreaterThan(result.startingUsd)
    expect(result.endingSol).toBeCloseTo(result.endingUsd / 150, 6)
  })

  it('applies fees on both sides, so a flat trade still loses money', () => {
    const result = runDemoPortfolio([{ ...tradeOf(0), verdict: 'FLAT' }], cfg)
    // (1+0) × 0.995² − 1; NOT a plain −1%, which understates the drag.
    expect(result.positions[0].netReturnPct).toBeCloseTo(FEE_FACTOR - 1, 10)
    expect(result.endingUsd).toBeLessThan(result.startingUsd)
  })

  it('skips unpriceable signals and counts them', () => {
    const result = runDemoPortfolio(
      [{ ...tradeOf(0), returnPct: null, verdict: 'UNPRICEABLE' }],
      cfg,
    )
    expect(result.positions).toHaveLength(0)
    expect(result.skippedUnpriceable).toBe(1)
    expect(result.endingUsd).toBe(result.startingUsd)
  })

  it('trades each contract ONCE, so repeated alerts cannot stack exposure', () => {
    const repeats = Array.from({ length: 4 }, (_, i) => ({
      ...tradeOf(-0.5, 'MintZ'),
      signalAt: `2026-10-0${i + 1}T00:00:00Z`,
      horizon: (['h1', 'h4', 'h24', 'd7'] as const)[i],
      verdict: 'STOPPED' as const,
    }))
    const result = runDemoPortfolio(repeats, cfg)
    expect(result.positions).toHaveLength(1)
  })

  it('never overspends: skips signals once cash is gone', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...tradeOf(-0.9, `Mint${i}`),
      signalAt: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      verdict: 'STOPPED' as const,
    }))
    const result = runDemoPortfolio(many, { ...cfg, maxPositionPct: 0.5 })
    expect(result.endingUsd).toBeGreaterThanOrEqual(0)
    expect(result.skippedNoCapital + result.positions.length).toBe(20)
  })

  it('processes trades chronologically regardless of input order', () => {
    const result = runDemoPortfolio(
      [
        { ...tradeOf(1, 'MintLate'), signalAt: '2026-10-05T00:00:00Z', verdict: 'TARGET' },
        { ...tradeOf(1, 'MintEarly'), signalAt: '2026-10-01T00:00:00Z', verdict: 'TARGET' },
      ],
      cfg,
    )
    expect(result.positions).toHaveLength(2)
    // the Oct-01 trade sized first, compounding the equity for the later one
    expect(result.positions[0].notionalUsd).toBeLessThan(result.positions[1].notionalUsd)
  })

  it('is deterministic for identical input', () => {
    const trades = [{ ...tradeOf(0.7), verdict: 'TARGET' as const }]
    expect(runDemoPortfolio(trades, cfg)).toEqual(runDemoPortfolio(trades, cfg))
  })
})
