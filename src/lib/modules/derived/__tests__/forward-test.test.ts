// Pure forward-test tests. No network — signal and price inputs are synthetic,
// so every verdict is an assertion about the decision rules, not data.
import { describe, it, expect } from 'vitest'
import {
  emptyForwardState,
  openForwardPosition,
  closeForwardPosition,
  classifyForwardExit,
  forwardEquityUsd,
  duePositions,
  summariseForward,
  untradedSignals,
  horizonDueMs,
  FORWARD_DEFAULTS,
} from '../forward-test'

const CFG = {
  startingSol: 10,
  solPriceUsd: 150,
  maxPositionPct: 0.1,
  feePct: 0,
  verdicts: { targetPct: 0.5, stopPct: 0.35, flatBandPct: 0.05 },
}

function sig(contract: string, at: string) {
  return { contract, at }
}

describe('openForwardPosition', () => {
  it('sizes the position at cash × maxPositionPct', () => {
    const state = emptyForwardState(10, 150)
    const at = new Date(Date.now() - 8 * 3_600_000).toISOString() // 8h ago
    const pos = openForwardPosition(state, sig('M1', at), 2, 'h4', { ...CFG, ...FORWARD_DEFAULTS })
    expect(pos).not.toBeNull()
    expect(pos!.notionalUsd).toBeCloseTo(150)
    expect(pos!.horizon).toBe('h4')
  })

  it('refuses an already-traded contract (one position per contract)', () => {
    const state = emptyForwardState(10, 150)
    const at = new Date(Date.now() - 8 * 3_600_000).toISOString()
    const p = openForwardPosition(state, sig('M1', at), 2, 'h4', { ...CFG, ...FORWARD_DEFAULTS })
    state.open.push(p!)
    state.seenContracts.push('M1')
    const again = openForwardPosition(state, sig('M1', at), 2, 'h4', { ...CFG, ...FORWARD_DEFAULTS })
    expect(again).toBeNull()
  })

  it('refuses a zero or negative price', () => {
    const state = emptyForwardState(10, 150)
    const at = new Date(Date.now() - 8 * 3_600_000).toISOString()
    expect(openForwardPosition(state, sig('M1', at), 0, 'h4', { ...CFG, ...FORWARD_DEFAULTS })).toBeNull()
  })
})

describe('closeForwardPosition', () => {
  const cfg = { ...CFG, ...FORWARD_DEFAULTS, feePct: 0 }

  it('labels a +100% move TARGET', () => {
    const pos = { contract: 'M1', openedAt: '2026-10-13T00:00:00Z', horizon: 'h4' as const, dueAt: '2026-10-13T04:00:00Z', notionalUsd: 150, entryPriceUsd: 1 }
    const c = closeForwardPosition(pos, 2, cfg)
    expect(c.verdict).toBe('TARGET')
    // feePct 0 in this config: gross × 1 × 1 − 1 = +100%
    expect(c.returnPct).toBeCloseTo(1, 6)
  })

  it('labels a -40% move STOPPED', () => {
    const pos = { contract: 'M1', openedAt: '2026-10-13T00:00:00Z', horizon: 'h4' as const, dueAt: '2026-10-13T04:00:00Z', notionalUsd: 150, entryPriceUsd: 1 }
    const c = closeForwardPosition(pos, 0.6, cfg)
    expect(c.verdict).toBe('STOPPED')
  })

  it('charges fees on both legs', () => {
    const pos = { contract: 'M1', openedAt: '2026-10-13T00:00:00Z', horizon: 'h4' as const, dueAt: '2026-10-13T04:00:00Z', notionalUsd: 100, entryPriceUsd: 1 }
    const c = closeForwardPosition(pos, 1, { ...cfg, feePct: 0.01 })
    expect(c.returnPct).toBeCloseTo(0.99 * 0.99 - 1, 6)
  })
})

describe('equity and maturity', () => {
  it('equity is cash plus open notional', () => {
    const state = emptyForwardState(10, 150)
    expect(forwardEquityUsd(state)).toBe(1500)
    state.open.push({ contract: 'M1', openedAt: '2026-10-13T00:00:00Z', horizon: 'h4', dueAt: '2026-10-13T04:00:00Z', notionalUsd: 150, entryPriceUsd: 1 })
    state.cashUsd -= 150
    expect(forwardEquityUsd(state)).toBe(1500)
  })

  it('duePositions returns only matured positions', () => {
    const state = emptyForwardState(10, 150)
    const now = Date.now()
    const past = new Date(now - 8 * 3_600_000).toISOString()
    const future = new Date(now + 8 * 3_600_000).toISOString()
    state.open.push({ contract: 'M1', openedAt: past, horizon: 'h1', dueAt: future, notionalUsd: 10, entryPriceUsd: 1 })
    state.open.push({ contract: 'M2', openedAt: past, horizon: 'h1', dueAt: past, notionalUsd: 10, entryPriceUsd: 1 })
    expect(duePositions(state, now).map((p) => p.contract)).toEqual(['M2'])
  })

  it('horizonDueMs maps h1/h4/h24/d7 to hours', () => {
    const t0 = 1_760_000_000_000
    expect(horizonDueMs(t0, 'h1')).toBe(t0 + 3_600_000)
    expect(horizonDueMs(t0, 'd7')).toBe(t0 + 168 * 3_600_000)
  })
})

describe('untradedSignals', () => {
  it('returns only contracts not yet traded, oldest first, capped', () => {
    const state = emptyForwardState(10, 150)
    state.seenContracts.push('M2')
    const now = Date.now()
    const signals = [
      sig('M1', new Date(now - 3_600_000).toISOString()),
      sig('M2', new Date(now - 2 * 3_600_000).toISOString()),
      sig('M3', new Date(now - 4 * 3_600_000).toISOString()),
    ]
    const un = untradedSignals(signals, state, 3)
    // Newest first: the strategy trades what it selects today.
    expect(un.map((s) => s.contract)).toEqual(['M1', 'M3'])
  })
})

describe('summariseForward', () => {
  it('holds null rates with zero closed trades', () => {
    const state = emptyForwardState(10, 150)
    const s = summariseForward(state)
    expect(s.closed).toBe(0)
    expect(s.winRatePct).toBeNull()
    expect(s.avgReturnPct).toBeNull()
  })

  it('computes win rate and equity return across closed trades', () => {
    const state = emptyForwardState(10, 150)
    state.open.push({ contract: 'M1', openedAt: '2026-10-13T00:00:00Z', horizon: 'h4', dueAt: '2026-10-13T04:00:00Z', notionalUsd: 150, entryPriceUsd: 1 })
    // Cash was already 1500 with notional tracked separately by equity; the
    // stake is not "moved" out of cash by this pure helper, so the realised
    // proceeds alone change cash.
    const close = closeForwardPosition(state.open[0], 2.5, { ...CFG, feePct: 0 })
    state.closed.push(close)
    state.open = []
    state.cashUsd += close.pnlUsd // +225 on a 150 stake
    const s = summariseForward(state)
    expect(s.closed).toBe(1)
    expect(s.wins).toBe(1)
    // start 1500; one 150 stake returning +150% realises +225 → 1725 equity
    expect(s.equityUsd).toBeCloseTo(1725, 6)
    expect(s.returnPct).toBeCloseTo(0.15, 6)
  })

  it('classifyForwardExit respects the flat band', () => {
    expect(classifyForwardExit(0.02)).toBe('FLAT')
    expect(classifyForwardExit(-0.02)).toBe('FLAT')
    expect(classifyForwardExit(0.5)).toBe('TARGET')
    expect(classifyForwardExit(-0.34)).toBe('FLAT')
    expect(classifyForwardExit(-0.36)).toBe('STOPPED')
  })
})
