import { describe, it, expect } from 'vitest'
import { classifyHuman, AXIOM_THRESHOLDS } from '../axiom-monitor'

describe('classifyHuman', () => {
  it('flags a human wallet with low fast-tx and balanced buys/sells', () => {
    const r = classifyHuman({ fastTxRatio: 0.16, buyCount30d: 6700, sellCount30d: 2992 })
    expect(r.isHuman).toBe(true)
    expect(r.reason).toContain('fast-tx 16%')
  })

  it('flags a bot wallet with high fast-tx ratio (>=50%)', () => {
    const r = classifyHuman({ fastTxRatio: 0.6, buyCount30d: 100, sellCount30d: 50 })
    expect(r.isHuman).toBe(false)
    expect(r.reason).toContain('sniper-bot')
  })

  it('flags a buy-only bot (50+ buys, 0 sells)', () => {
    const r = classifyHuman({ fastTxRatio: 0.2, buyCount30d: 60, sellCount30d: 0 })
    expect(r.isHuman).toBe(false)
    expect(r.reason).toContain('dump-and-abandon')
  })

  it('rejects wallets with too few buys (< 10)', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 5, sellCount30d: 2 })
    expect(r.isHuman).toBe(false)
    expect(r.reason).toContain('too few buys')
  })

  it('handles null fastTxRatio gracefully (human when buys/sells balanced)', () => {
    const r = classifyHuman({ fastTxRatio: null, buyCount30d: 100, sellCount30d: 50 })
    expect(r.isHuman).toBe(true)
    expect(r.reason).toContain('fast-tx unknown')
  })

  it('handles all-null stats as not human (too few buys)', () => {
    const r = classifyHuman({ fastTxRatio: null, buyCount30d: null, sellCount30d: null })
    expect(r.isHuman).toBe(false)
  })

  it('keeps a buy-only wallet when buys < 50 (not enough to call it a bot)', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 30, sellCount30d: 0 })
    expect(r.isHuman).toBe(true)
  })

  it('exposes operator defaults', () => {
    expect(AXIOM_THRESHOLDS.minWinRate).toBe(0.6)
    expect(AXIOM_THRESHOLDS.maxFastTxRatio).toBe(0.5)
    expect(AXIOM_THRESHOLDS.minBuyCount).toBe(10)
  })
})
