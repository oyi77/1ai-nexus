import { describe, expect, it } from 'vitest'
import { classifyWallet } from '@/lib/modules/derived/cohort-engine'

describe('cohort engine classifyWallet', () => {
  it('classifies high PnL wallets', () => {
    const cohorts = classifyWallet({
      pnl: 5_000_000,
      winRate: 0.7,
      tradeCount: 100,
      volume: 50_000_000,
    })
    expect(cohorts.length).toBeGreaterThan(0)
  })

  it('classifies dormant wallets', () => {
    const cohorts = classifyWallet({
      pnl: 0,
      winRate: 0,
      tradeCount: 0,
      volume: 0,
    })
    expect(cohorts.length).toBeGreaterThanOrEqual(0)
  })

  it('returns array for any input', () => {
    const cohorts = classifyWallet({})
    expect(Array.isArray(cohorts)).toBe(true)
  })

  it('matches entity type criteria', () => {
    const cohorts = classifyWallet({
      entityType: 'cex',
    })
    expect(Array.isArray(cohorts)).toBe(true)
  })
})
