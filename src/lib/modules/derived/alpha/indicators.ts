// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Pure Calculation Functions
// ATR 14-period, Regime Detection, Trading Levels, Valid Period
// ─────────────────────────────────────────────────────────────

import type { KlinesData, Regime, ValidPeriod } from './types'

/**
 * Compute ATR 14-period (EMA of True Range)
 */
export function computeATR14(kd: KlinesData): number {
  const { closes, highs, lows } = kd
  if (closes.length < 15) return 0
  const trs: number[] = []
  for (let i = 1; i < closes.length; i++) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    )
  }
  // ATR = EMA of TR
  let atr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14
  const k = 2 / 15
  for (let i = 14; i < trs.length; i++) atr += (trs[i] - atr) * k
  return atr
}

/**
 * Detect market regime based on 14-period SMA divergence
 */
export function detectRegime(
  kd: KlinesData,
): { regime: Regime; sma14: number } {
  const { closes } = kd
  if (closes.length < 14)
    return { regime: 'chop', sma14: closes[closes.length - 1] ?? 0 }
  const sma14 = closes.reduce((a, b) => a + b, 0) / closes.length
  const price = closes[closes.length - 1]
  const trend = (price - sma14) / sma14
  return {
    regime:
      Math.abs(trend) > 0.03
        ? trend > 0
          ? 'trend-bull'
          : 'trend-bear'
        : 'chop',
    sma14,
  }
}

/**
 * Calculate trading levels with ATR 14-period and regime awareness
 */
export function calculateLevels(
  price: number,
  atr14: number,
  direction: 'bullish' | 'bearish' | 'neutral',
  regime: Regime = 'chop',
): { entry: number; tp1: number; tp2: number; tp3: number; sl: number } | null {
  if (!price || price <= 0 || atr14 <= 0) return null

  // Regime-aware multipliers
  // In trend: wider SL (allow breathing room), TP extended
  // In chop: tighter SL, take profits faster
  const [tpMul, slMul] = regime.startsWith('trend')
    ? [1.0, 0.6] // trend: TP 1.0×ATR, SL 0.6×ATR → R:R 1.67:1
    : [0.65, 0.4] // chop: TP 0.65×ATR, SL 0.4×ATR → R:R 1.625:1

  if (direction === 'bullish') {
    return {
      entry: price,
      tp1: price + atr14 * tpMul,
      tp2: price + atr14 * tpMul * 2,
      tp3: price + atr14 * tpMul * 4,
      sl: price - atr14 * slMul,
    }
  } else if (direction === 'bearish') {
    return {
      entry: price,
      tp1: price - atr14 * tpMul,
      tp2: price - atr14 * tpMul * 2,
      tp3: price - atr14 * tpMul * 4,
      sl: price + atr14 * slMul,
    }
  }
  return null
}

/**
 * Determine valid period based on signal source and strength
 */
export function determineValidPeriod(
  source: string,
  strength: number,
): ValidPeriod {
  // High-strength signals get longer validity
  if (strength >= 80) return '7d'
  // Funding rate and whale signals are medium-term
  if (source === 'funding-rate' || source === 'whale-alert') return '24h'
  // Trade flow and sentiment are shorter-term
  return '4h'
}
