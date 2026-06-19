// ─────────────────────────────────────────────────────────────
// Technical Indicators — Computed from OHLCV candles
// SMA, EMA, RSI, MACD, Bollinger Bands
// ─────────────────────────────────────────────────────────────

import type { OhlcvCandle } from './price-store'

export interface IndicatorResult {
  name: string
  values: Array<{ time: number; value: number }>
  signal?: 'buy' | 'sell' | 'neutral'
}

/** Simple Moving Average */
export function sma(candles: OhlcvCandle[], period: number): IndicatorResult {
  const values: Array<{ time: number; value: number }> = []
  for (let i = period - 1; i < candles.length; i++) {
    const sum = candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0)
    values.push({ time: candles[i].time, value: sum / period })
  }
  const last = values[values.length - 1]?.value ?? 0
  const prev = values[values.length - 2]?.value ?? 0
  return { name: `SMA${period}`, values, signal: last > prev ? 'buy' : last < prev ? 'sell' : 'neutral' }
}

/** Exponential Moving Average */
export function ema(candles: OhlcvCandle[], period: number): IndicatorResult {
  const values: Array<{ time: number; value: number }> = []
  const multiplier = 2 / (period + 1)

  // First EMA = SMA
  let sum = 0
  for (let i = 0; i < period && i < candles.length; i++) sum += candles[i].close
  let prevEma = sum / period
  values.push({ time: candles[period - 1].time, value: prevEma })

  for (let i = period; i < candles.length; i++) {
    const emaVal = (candles[i].close - prevEma) * multiplier + prevEma
    values.push({ time: candles[i].time, value: emaVal })
    prevEma = emaVal
  }

  const last = values[values.length - 1]?.value ?? 0
  const prev = values[values.length - 2]?.value ?? 0
  return { name: `EMA${period}`, values, signal: last > prev ? 'buy' : last < prev ? 'sell' : 'neutral' }
}

/** Relative Strength Index */
export function rsi(candles: OhlcvCandle[], period = 14): IndicatorResult {
  const values: Array<{ time: number; value: number }> = []
  if (candles.length < period + 1) return { name: `RSI${period}`, values }

  const changes: number[] = []
  for (let i = 1; i < candles.length; i++) {
    changes.push(candles[i].close - candles[i - 1].close)
  }

  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period

  for (let i = period; i < changes.length; i++) {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    const rsiVal = 100 - (100 / (1 + rs))
    values.push({ time: candles[i + 1].time, value: rsiVal })

    const change = changes[i]
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period
  }

  const last = values[values.length - 1]?.value ?? 50
  return {
    name: `RSI${period}`,
    values,
    signal: last < 30 ? 'buy' : last > 70 ? 'sell' : 'neutral',
  }
}

/** MACD (Moving Average Convergence Divergence) */
export function macd(candles: OhlcvCandle[], fast = 12, slow = 26, signal = 9): {
  macd: IndicatorResult
  signalLine: IndicatorResult
  histogram: IndicatorResult
} {
  const emaFast = ema(candles, fast)
  const emaSlow = ema(candles, slow)

  // Align by time
  const slowTimes = new Set(emaSlow.values.map(v => v.time))
  const macdValues: Array<{ time: number; value: number }> = []

  for (const fastVal of emaFast.values) {
    if (!slowTimes.has(fastVal.time)) continue
    const slowVal = emaSlow.values.find(v => v.time === fastVal.time)
    if (slowVal) {
      macdValues.push({ time: fastVal.time, value: fastVal.value - slowVal.value })
    }
  }

  // Signal line = EMA of MACD
  const signalValues: Array<{ time: number; value: number }> = []
  if (macdValues.length >= signal) {
    const multiplier = 2 / (signal + 1)
    let sum = 0
    for (let i = 0; i < signal; i++) sum += macdValues[i].value
    let prevEma = sum / signal
    signalValues.push({ time: macdValues[signal - 1].time, value: prevEma })

    for (let i = signal; i < macdValues.length; i++) {
      const emaVal = (macdValues[i].value - prevEma) * multiplier + prevEma
      signalValues.push({ time: macdValues[i].time, value: emaVal })
      prevEma = emaVal
    }
  }

  // Histogram = MACD - Signal
  const histogramValues: Array<{ time: number; value: number }> = []
  for (const macdVal of macdValues) {
    const sigVal = signalValues.find(v => v.time === macdVal.time)
    if (sigVal) {
      histogramValues.push({ time: macdVal.time, value: macdVal.value - sigVal.value })
    }
  }

  const lastHist = histogramValues[histogramValues.length - 1]?.value ?? 0
  const prevHist = histogramValues[histogramValues.length - 2]?.value ?? 0

  return {
    macd: { name: 'MACD', values: macdValues },
    signalLine: { name: 'Signal', values: signalValues },
    histogram: {
      name: 'Histogram',
      values: histogramValues,
      signal: lastHist > 0 && prevHist <= 0 ? 'buy' : lastHist < 0 && prevHist >= 0 ? 'sell' : 'neutral',
    },
  }
}

/** Bollinger Bands */
export function bollingerBands(candles: OhlcvCandle[], period = 20, stdDev = 2): {
  upper: IndicatorResult
  middle: IndicatorResult
  lower: IndicatorResult
} {
  const middleValues: Array<{ time: number; value: number }> = []
  const upperValues: Array<{ time: number; value: number }> = []
  const lowerValues: Array<{ time: number; value: number }> = []

  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1)
    const mean = slice.reduce((s, c) => s + c.close, 0) / period
    const variance = slice.reduce((s, c) => s + (c.close - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)

    middleValues.push({ time: candles[i].time, value: mean })
    upperValues.push({ time: candles[i].time, value: mean + stdDev * std })
    lowerValues.push({ time: candles[i].time, value: mean - stdDev * std })
  }

  const lastClose = candles[candles.length - 1]?.close ?? 0
  const lastUpper = upperValues[upperValues.length - 1]?.value ?? 0
  const lastLower = lowerValues[lowerValues.length - 1]?.value ?? 0

  return {
    upper: { name: 'BB Upper', values: upperValues },
    middle: { name: 'BB Middle', values: middleValues },
    lower: {
      name: 'BB Lower',
      values: lowerValues,
      signal: lastClose <= lastLower ? 'buy' : lastClose >= lastUpper ? 'sell' : 'neutral',
    },
  }
}
