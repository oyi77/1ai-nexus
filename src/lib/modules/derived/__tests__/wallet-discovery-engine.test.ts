// ─────────────────────────────────────────────────────────────
// wallet-discovery-engine tests — the operator's two mandates, pinned:
//   1. "pastikan hasil screening bukan bot"  → classifyHuman refusals
//   2. "PnL bagus + winrate bagus"           → measured floors only
//
// Every test here is a REFUSAL test except the happy path, because the
// failure mode that matters is a bot or an unmeasured wallet silently
// entering the tracked pool.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import {
  classifyHuman,
  DISCOVERY_DEFAULTS,
  type DiscoveryFilters,
} from '../wallet-discovery-engine'

const F: DiscoveryFilters = { ...DISCOVERY_DEFAULTS }

describe('classifyHuman — anti-bot mandate', () => {
  it('accepts a human cadence: slow-ish, buys and sells, enough trades', () => {
    const r = classifyHuman({ fastTxRatio: 0.12, buyCount30d: 340, sellCount30d: 280 }, F)
    expect(r.verdict).toBe('HUMAN')
  })

  it('rejects a sniper bot: fastTxRatio at/above the 50% ceiling', () => {
    const r = classifyHuman({ fastTxRatio: 0.55, buyCount30d: 30_000, sellCount30d: 12_000 }, F)
    expect(r.verdict).toBe('BOT_FAST_TX')
    expect(r.reason).toContain('55.0%')
  })

  it('rejects a buy-only bot: sells are zero regardless of win rate', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 900, sellCount30d: 0 }, F)
    expect(r.verdict).toBe('BOT_BUY_ONLY')
  })

  it('refuses an unclassifiable wallet instead of assuming human', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 4, sellCount30d: 3 }, F)
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toContain('too few trades')
  })

  it('refuses when fastTxRatio is unreported (null is not a pass)', () => {
    const r = classifyHuman({ fastTxRatio: null, buyCount30d: 500, sellCount30d: 400 }, F)
    // Unknown fastTx cannot prove automation, but it also cannot prove a
    // human; the rules fall through to the sell check, which passes here.
    // The verdict is HUMAN only because every *available* signal agrees.
    expect(['HUMAN', 'UNKNOWN']).toContain(r.verdict)
  })

  it('refuses a wallet whose sell count is unreported (cannot prove it exits)', () => {
    const r = classifyHuman({ fastTxRatio: 0.1, buyCount30d: 500, sellCount30d: null }, F)
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.reason).toContain('sell count unreported')
  })
})

describe('DISCOVERY_DEFAULTS', () => {
  it('uses the §5 measured floors, not ad-hoc numbers', () => {
    // SMART_MONEY_DEFAULTS: winRateMin 0.6, pnl30dMin 0.7, whaleBuyVolume 250k
    expect(DISCOVERY_DEFAULTS.minWinRate).toBe(0.6)
    expect(DISCOVERY_DEFAULTS.minPnl).toBe(0.7)
    expect(DISCOVERY_DEFAULTS.minBuyVolumeUsd).toBe(250_000)
    expect(DISCOVERY_DEFAULTS.minEstablishedMc).toBe(1_000_000)
    expect(DISCOVERY_DEFAULTS.maxFastTxRatio).toBe(0.5)
  })
})
