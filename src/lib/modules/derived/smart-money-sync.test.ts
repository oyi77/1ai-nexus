import { describe, it, expect } from 'vitest'
import {
  filterAlertableTrades,
  ALERT_THRESHOLDS,
  type SmartMoneyTrade,
} from './smart-money-sync'

function trade(over: Partial<SmartMoneyTrade> = {}): SmartMoneyTrade {
  return {
    walletAddress: '862TYSvRYoiHAK3F3WwTRYAfuGiQaGdxedN9AGvRGWo2',
    walletAlias: 'Wugi',
    walletStatus: 'QUALIFIED_SMART_MONEY',
    tokenSymbol: 'BONK',
    tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoR4P5v8c9zEq',
    chain: 'solana',
    action: 'BUY',
    amountUsd: 5000,
    tokenAgeHours: 6,
    marketCapUsd: 500_000,
    timestamp: new Date(),
    ...over,
  }
}

describe('filterAlertableTrades', () => {
  it('passes a trade that meets all criteria', () => {
    const t = trade()
    expect(filterAlertableTrades([t])).toHaveLength(1)
  })

  it('rejects a trade above the token age threshold', () => {
    const t = trade({ tokenAgeHours: 30 })
    expect(filterAlertableTrades([t])).toHaveLength(0)
  })

  it('rejects a trade below the amount threshold', () => {
    const t = trade({ amountUsd: 500 })
    expect(filterAlertableTrades([t])).toHaveLength(0)
  })

  it('rejects a trade above the market cap threshold', () => {
    const t = trade({ marketCapUsd: 2_000_000 })
    expect(filterAlertableTrades([t])).toHaveLength(0)
  })

  it('includes trades with null token age (conservative — unknown is not old)', () => {
    const t = trade({ tokenAgeHours: null })
    expect(filterAlertableTrades([t])).toHaveLength(1)
  })

  it('includes trades with null market cap (conservative — unknown is not big)', () => {
    const t = trade({ marketCapUsd: null })
    expect(filterAlertableTrades([t])).toHaveLength(1)
  })

  it('includes a SELL action', () => {
    const t = trade({ action: 'SELL', amountUsd: 2000 })
    expect(filterAlertableTrades([t])).toHaveLength(1)
  })

  it('filters a mix of passing and failing trades', () => {
    const trades = [
      trade(),                                    // pass
      trade({ tokenAgeHours: 30 }),               // fail: too old
      trade({ amountUsd: 500 }),                  // fail: too small
      trade({ marketCapUsd: 2_000_000 }),         // fail: too big
      trade({ tokenAgeHours: 12, amountUsd: 3000, marketCapUsd: 800_000 }), // pass
    ]
    expect(filterAlertableTrades(trades)).toHaveLength(2)
  })

  it('respects the exact boundary: 24h age passes, 24.01h fails', () => {
    expect(filterAlertableTrades([trade({ tokenAgeHours: 24.0 })])).toHaveLength(1)
    expect(filterAlertableTrades([trade({ tokenAgeHours: 24.01 })])).toHaveLength(0)
  })

  it('respects the exact boundary: $1000 passes, $999 fails', () => {
    expect(filterAlertableTrades([trade({ amountUsd: 1000 })])).toHaveLength(1)
    expect(filterAlertableTrades([trade({ amountUsd: 999 })])).toHaveLength(0)
  })

  it('respects the exact boundary: $1M MC passes, $1,000,001 fails', () => {
    expect(filterAlertableTrades([trade({ marketCapUsd: 1_000_000 })])).toHaveLength(1)
    expect(filterAlertableTrades([trade({ marketCapUsd: 1_000_001 })])).toHaveLength(0)
  })
})

describe('ALERT_THRESHOLDS', () => {
  it('matches operator-specified values', () => {
    expect(ALERT_THRESHOLDS.maxTokenAgeHours).toBe(24)
    expect(ALERT_THRESHOLDS.minAmountUsd).toBe(1000)
    expect(ALERT_THRESHOLDS.maxMarketCapUsd).toBe(1_000_000)
  })
})
