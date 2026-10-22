import { describe, it, expect } from 'vitest'
import {
  classifyForSheet,
  filterAlertableTrades,
  renderSmartMoneyAlert,
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
    winRate: 0.78,
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

  it('rejects every non-bullish wallet status even when every numeric gate passes', () => {
    for (const status of ['WATCHLIST', 'PROVISIONAL', 'DISQUALIFIED', 'TRACER_PNL', 'UNKNOWN', 'FIRST_SEEN', null]) {
      const t = trade({ walletStatus: status })
      expect(filterAlertableTrades([t]), `status ${String(status)} must not alert`).toHaveLength(0)
    }
  })

  it('accepts each bullish status: WHALE, QUALIFIED_SMART_MONEY, WHALE_AND_SMART_MONEY', () => {
    for (const status of ['WHALE', 'QUALIFIED_SMART_MONEY', 'WHALE_AND_SMART_MONEY']) {
      expect(filterAlertableTrades([trade({ walletStatus: status })])).toHaveLength(1)
    }
  })
})

describe('classifyForSheet', () => {
  it('marks an alertable trade ALERT with no reason', () => {
    expect(classifyForSheet(trade())).toEqual({ outcome: 'ALERT', reason: '' })
  })

  it('marks a non-qualifying wallet OBSERVATION and names the status', () => {
    const v = classifyForSheet(trade({ walletStatus: 'WATCHLIST' }))
    expect(v.outcome).toBe('OBSERVATION')
    expect(v.reason).toContain('WATCHLIST')
  })

  it('names the exact numeric gate that blocked a qualified wallet', () => {
    expect(classifyForSheet(trade({ amountUsd: 400 })).reason).toContain('amount $400 under $1000')
    expect(classifyForSheet(trade({ tokenAgeHours: 40 })).reason).toContain('token age 40.0h over 24h')
    expect(classifyForSheet(trade({ marketCapUsd: 5_000_000 })).reason).toContain('market cap $5000000 over $1000000')
  })

  it('leaves the reason empty only when the trade really alerts', () => {
    const t = trade({ walletStatus: 'WHALE', amountUsd: 1000, tokenAgeHours: 24, marketCapUsd: 1_000_000 })
    expect(classifyForSheet(t)).toEqual({ outcome: 'ALERT', reason: '' })
  })
})

describe('ALERT_THRESHOLDS', () => {
  it('matches operator-specified values', () => {
    expect(ALERT_THRESHOLDS.maxTokenAgeHours).toBe(24)
    expect(ALERT_THRESHOLDS.minAmountUsd).toBe(1000)
    expect(ALERT_THRESHOLDS.maxMarketCapUsd).toBe(1_000_000)
  })
})

describe('renderSmartMoneyAlert', () => {
  it('formats modern header, dividers, CA tap-to-copy, amount, and wallet info', () => {
    const t = trade()
    const text = renderSmartMoneyAlert(t)
    expect(text).toContain('🧠 <b>SMART MONEY ACTIVITY</b>')
    expect(text).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━')
    expect(text).toContain('🟢 <b>BUY</b> · <b>$BONK</b>')
    expect(text).toContain(`📋 <b>CA:</b> <code>${t.tokenAddress}</code> <i>(tap to copy)</i>`)
    expect(text).toContain('💰 <b>Amount:</b> <b>$5,000</b>')
    expect(text).toContain('📊 <b>Market Cap:</b> $500K  |  ⏱ <b>Age:</b> 6.0h')
    expect(text).toContain('👤 <b>Wallet:</b> <b>Wugi</b> [QUALIFIED_SMART_MONEY]')
    expect(text).toContain('📈 Win Rate: <b>78%</b>')
    expect(text).toContain(`   └ <code>${t.walletAddress}</code>`)
    expect(text).toContain('UTC')
  })

  it('handles SELL action with red indicator and fallback alias', () => {
    const t = trade({
      action: 'SELL',
      walletAlias: null,
      walletStatus: 'WHALE',
      amountUsd: 12500,
      tokenAgeHours: null,
      marketCapUsd: 1_200_000,
    })
    const text = renderSmartMoneyAlert(t)
    expect(text).toContain('🔴 <b>SELL</b> · <b>$BONK</b>')
    expect(text).toContain('💰 <b>Amount:</b> <b>$12,500</b>')
    expect(text).toContain('📊 <b>Market Cap:</b> $1.2M  |  ⏱ <b>Age:</b> unknown')
    expect(text).toContain(`👤 <b>Wallet:</b> <b>${t.walletAddress.slice(0, 8)}…</b> [WHALE]`)
  })

  it('renders n/a win rate when the DB value is genuinely null', () => {
    const t = trade({ winRate: null })
    const text = renderSmartMoneyAlert(t)
    expect(text).toContain('📈 Win Rate: <i>n/a</i>')
    expect(text).not.toContain('Win Rate: <b>')
  })
})
