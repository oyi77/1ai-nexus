import { describe, it, expect, vi, type Mock } from 'vitest'

import { runPaperBuyCron, type PaperCronDeps } from './paper-buy-cron'
import type { SignalOutcome } from '@/lib/modules/derived/sniper-outcomes'

const T0 = '2026-10-12T00:00:00.000Z'

function signal(over: Partial<SignalOutcome> = {}): SignalOutcome {
  return {
    contract: 'mint111',
    ticker: 'TOK',
    tier: 'HIGH_CONVICTION',
    deliveredAt: T0,
    entryMarketCapUsd: 100_000,
    horizonHours: 24,
    dueAt: '2026-10-13T00:00:00.000Z',
    exitMarketCapUsd: null,
    returnPct: null,
    verdict: 'PENDING',
    scoredAt: null,
    ...over,
  }
}

function deps(signals: SignalOutcome[]): PaperCronDeps & { deliver: Mock<PaperCronDeps['deliver']> } {
  return {
    loadSignals: async () => signals,
    deliver: vi.fn<PaperCronDeps['deliver']>(async () => true),
    reviewChatId: () => '123',
    notionalUsd: () => 100,
    sendSummary: () => true,
  }
}

describe('runPaperBuyCron — outbound suppression', () => {
  it('empty paper book: nothing is pushed to the review chat', async () => {
    const d = deps([])
    const text = await runPaperBuyCron(d)
    expect(text).toBeNull()
    expect(d.deliver).not.toHaveBeenCalled()
  })

  it('one delivered signal: exactly one summary push', async () => {
    const d = deps([signal()])
    const text = await runPaperBuyCron(d)
    expect(d.deliver).toHaveBeenCalledTimes(1)
    expect(d.deliver).toHaveBeenCalledWith(expect.stringContaining('PAPER TRADING SUMMARY'), '123')
    expect(typeof text).toBe('string')
  })
})
