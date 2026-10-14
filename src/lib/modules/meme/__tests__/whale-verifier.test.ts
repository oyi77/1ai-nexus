// ─────────────────────────────────────────────────────────────
// Whale verification gate unit tests (pure — no network/DB/sheet).
// Covers the §5 thresholds imported from SMART_MONEY_DEFAULTS.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { verifyWhaleForList } from '../whale-verifier'
import { SMART_MONEY_DEFAULTS } from '../../derived/wallet-intel'

describe('verifyWhaleForList', () => {
  it('excludes null winrate (unmeasured is never safe)', () => {
    const v = verifyWhaleForList({ winRate30d: null, pnl30d: 0.8, buyVolume30d: null })
    expect(v.include).toBe(false)
    expect(v.label).toBe('UNVERIFIED')
  })

  it('excludes null pnl (unmeasured is never safe)', () => {
    const v = verifyWhaleForList({ winRate30d: 0.8, pnl30d: null, buyVolume30d: null })
    expect(v.include).toBe(false)
    expect(v.label).toBe('UNVERIFIED')
  })

  it('excludes winrate=0 and pnl=0 explicitly (no measurable quality)', () => {
    const v = verifyWhaleForList({ winRate30d: 0, pnl30d: 0, buyVolume30d: null })
    expect(v.include).toBe(false)
    expect(v.label).toBe('UNVERIFIED')
    expect(v.reason).toContain('winrate=0 and pnl=0')
  })

  it('includes buyVolume >= $250k as WHALE even with low wr/pnl', () => {
    const v = verifyWhaleForList({ winRate30d: 0.1, pnl30d: 0.05, buyVolume30d: 250_000 })
    expect(v.include).toBe(true)
    expect(v.label).toBe('WHALE')
  })

  it('is boundary-inclusive at exactly $250k and excludes $249,999.99', () => {
    expect(
      verifyWhaleForList({ winRate30d: 0.1, pnl30d: 0.05, buyVolume30d: 250_000 }).include,
    ).toBe(true)
    expect(
      verifyWhaleForList({ winRate30d: 0.1, pnl30d: 0.05, buyVolume30d: 249_999.99 }).include,
    ).toBe(false)
  })

  it('includes wr>=0.6 && pnl>=0.7 as QUALITY when volume is below the whale leg', () => {
    const v = verifyWhaleForList({ winRate30d: 0.6, pnl30d: 0.7, buyVolume30d: 100 })
    expect(v.include).toBe(true)
    expect(v.label).toBe('QUALITY')
  })

  it('excludes wr 0.59 pnl 0.8 (below winrate bar)', () => {
    const v = verifyWhaleForList({ winRate30d: 0.59, pnl30d: 0.8, buyVolume30d: 100 })
    expect(v.include).toBe(false)
    expect(v.label).toBe('UNVERIFIED')
  })

  it('excludes wr 0.6 pnl 0.69 (below pnl bar)', () => {
    const v = verifyWhaleForList({ winRate30d: 0.6, pnl30d: 0.69, buyVolume30d: 100 })
    expect(v.include).toBe(false)
    expect(v.label).toBe('UNVERIFIED')
  })

  it('emits deterministic reason strings mentioning GMGN', () => {
    const unmeasured = verifyWhaleForList({ winRate30d: null, pnl30d: 0.8, buyVolume30d: null })
    const whale = verifyWhaleForList({ winRate30d: 0.1, pnl30d: 0.05, buyVolume30d: 250_000 })
    const quality = verifyWhaleForList({ winRate30d: 0.7, pnl30d: 0.8, buyVolume30d: null })
    const below = verifyWhaleForList({ winRate30d: 0.4, pnl30d: 0.4, buyVolume30d: null })
    expect(unmeasured.reason).toBe('GMGN did not measure winrate or pnl')
    expect(whale.reason).toBe('30d buy volume ≥ $250k whale leg (GMGN-measured)')
    expect(quality.reason).toBe('winrate ≥ 60% and pnl ≥ 70% (GMGN-measured)')
    expect(below.reason).toBe('below §5 quality bars')
  })

  it('uses SMART_MONEY_DEFAULTS thresholds (no duplicated literals)', () => {
    expect(SMART_MONEY_DEFAULTS.whaleBuyVolume30dUsd).toBe(250_000)
    expect(SMART_MONEY_DEFAULTS.winRateMin).toBe(0.6)
    expect(SMART_MONEY_DEFAULTS.pnl30dMin).toBe(0.7)
    // Indirect proof: the gate honors exactly these thresholds.
    expect(
      verifyWhaleForList({
        winRate30d: SMART_MONEY_DEFAULTS.winRateMin,
        pnl30d: SMART_MONEY_DEFAULTS.pnl30dMin,
        buyVolume30d: null,
      }).include,
    ).toBe(true)
    expect(
      verifyWhaleForList({
        winRate30d: SMART_MONEY_DEFAULTS.winRateMin,
        pnl30d: SMART_MONEY_DEFAULTS.pnl30dMin,
        buyVolume30d: SMART_MONEY_DEFAULTS.whaleBuyVolume30dUsd,
      }).label,
    ).toBe('WHALE')
  })
})
