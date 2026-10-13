// Unit tests for the pure parts of the price observer. Network + JSON I/O
// are deliberately out of scope: observeSignalOutcomes imports the real
// readOutcomes/writeOutcomes, so the testable seams are the pure helpers
// extracted for exactly that reason.
import { describe, it, expect } from 'vitest'
import { buildCloseNotifications, selectPending } from '../meme-price-observer'
import type { OutcomeLog, SignalOutcome } from '../sniper-outcomes'

function signal(over: Partial<SignalOutcome> = {}): SignalOutcome {
  return {
    contract: 'mint111111111111111111111111111111111',
    ticker: 'TOK',
    tier: 'HIGH_CONVICTION',
    deliveredAt: '2026-10-12T00:00:00.000Z',
    entryMarketCapUsd: 1_000_000,
    horizonHours: 24,
    dueAt: '2026-10-13T00:00:00.000Z',
    exitMarketCapUsd: null,
    returnPct: null,
    verdict: 'PENDING',
    scoredAt: null,
    ...over,
  }
}

function log(signals: SignalOutcome[]): OutcomeLog {
  return { version: 1, signals, updatedAt: null }
}

describe('selectPending — only open signals are worth pricing', () => {
  it('returns exactly the PENDING subset', () => {
    const pendingA = signal({ contract: 'aaa' })
    const pendingB = signal({ contract: 'bbb', ticker: 'BTK' })
    const signals = [
      pendingA,
      signal({ contract: 'ccc', verdict: 'TARGET' }),
      pendingB,
      signal({ contract: 'ddd', verdict: 'UNPRICEABLE' }),
      signal({ contract: 'eee', verdict: 'FLAT' }),
    ]
    expect(selectPending(signals).map((s) => s.contract)).toEqual(['aaa', 'bbb'])
  })

  it('returns [] for an empty log', () => {
    expect(selectPending([])).toEqual([])
  })
})

describe('buildCloseNotifications — only signals that JUST closed', () => {
  it('is empty when nothing moved out of PENDING', () => {
    const before = log([signal({ contract: 'aaa' })])
    const after = log([signal({ contract: 'aaa' })])
    expect(buildCloseNotifications(before, after)).toEqual([])
  })

  it('is empty for an empty log', () => {
    expect(buildCloseNotifications(log([]), log([]))).toEqual([])
  })

  it('ignores PENDING, UNPRICEABLE, and signals already closed before this run', () => {
    const before = log([
      signal({ contract: 'aaa' }),
      signal({ contract: 'bbb', verdict: 'TARGET' }),
      signal({ contract: 'ccc', verdict: 'UNPRICEABLE' }),
    ])
    const after = log([
      signal({ contract: 'aaa' }),
      signal({ contract: 'bbb', verdict: 'TARGET' }),
      signal({ contract: 'ccc', verdict: 'UNPRICEABLE' }),
    ])
    expect(buildCloseNotifications(before, after)).toEqual([])
  })

  it('builds one HTML notification per freshly TARGET/STOPPED/FLAT signal', () => {
    const before = log([signal({ contract: 'aaa' }), signal({ contract: 'bbb' }), signal({ contract: 'ccc' })])
    const after = log([
      signal({ contract: 'aaa', verdict: 'TARGET', returnPct: 1.5, exitMarketCapUsd: 2_500_000 }),
      signal({ contract: 'bbb', verdict: 'STOPPED', returnPct: -0.6, exitMarketCapUsd: 400_000 }),
      signal({ contract: 'ccc', verdict: 'FLAT', returnPct: 0.1, exitMarketCapUsd: 1_100_000 }),
    ])
    const texts = buildCloseNotifications(before, after)
    expect(texts).toHaveLength(3)
    expect(texts[0]).toContain('🎯 TARGET')
    expect(texts[0]).toContain('+150.0%')
    expect(texts[1]).toContain('🛑 STOPPED')
    expect(texts[1]).toContain('-60.0%')
    expect(texts[2]).toContain('➖ FLAT')
    expect(texts[2]).toContain('+10.0%')
  })

  it('formats return percentages with sign and one decimal', () => {
    const before = log([signal({ contract: 'aaa' })])
    const after = log([signal({ contract: 'aaa', verdict: 'TARGET', returnPct: 1.234, exitMarketCapUsd: 2_234_000 })])
    const [text] = buildCloseNotifications(before, after)
    expect(text).toContain('+123.4%')
  })

  it('formats entry/exit as compact USD and HTML-escapes the ticker', () => {
    const before = log([signal({ contract: 'aaa', ticker: '<RUG>' })])
    const after = log([
      signal({ contract: 'aaa', ticker: '<RUG>', verdict: 'TARGET', returnPct: 1.0, exitMarketCapUsd: 2_000_000 }),
    ])
    const [text] = buildCloseNotifications(before, after)
    expect(text).toContain('&lt;RUG&gt;')
    expect(text).toContain('Entry: $1.00M')
    expect(text).toContain('Exit: $2.00M')
  })

  it('keeps each notification under the 4096-char Telegram limit', () => {
    const before = log([signal({ contract: 'aaa', ticker: 'X'.repeat(500) })])
    const after = log([
      signal({
        contract: 'aaa',
        ticker: 'X'.repeat(500),
        verdict: 'TARGET',
        returnPct: 1.0,
        exitMarketCapUsd: 2_000_000,
      }),
    ])
    const texts = buildCloseNotifications(before, after)
    expect(texts).toHaveLength(1)
    expect(texts[0].length).toBeLessThan(4096)
  })
})
