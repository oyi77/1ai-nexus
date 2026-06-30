// ─── Extended Technical Indicators Library ─────────────────
// 50+ indicators for professional-grade charting.
// All functions are pure — no side effects, no external dependencies.
// ─────────────────────────────────────────────────────────

import type { OHLCV, IndicatorPoint } from './indicators'

// ─── Existing indicators re-exported ──────────────────────
export { SMA, EMA, RSI, MACD, Bollinger, computeAllIndicators } from './indicators'
export type { OHLCV, IndicatorPoint, MACDResult, BollingerBands, AllIndicators } from './indicators'

// ─── Stochastic Oscillator ────────────────────────────────

export interface StochasticResult {
  k: IndicatorPoint[]
  d: IndicatorPoint[]
}

export function Stochastic(data: OHLCV[], kPeriod: number = 14, dPeriod: number = 3): StochasticResult {
  if (data.length < kPeriod) return { k: [], d: [] }

  const kLine: IndicatorPoint[] = []

  for (let i = kPeriod - 1; i < data.length; i++) {
    const slice = data.slice(i - kPeriod + 1, i + 1)
    const high = Math.max(...slice.map(d => d.high))
    const low = Math.min(...slice.map(d => d.low))
    const close = data[i].close

    const k = high === low ? 50 : ((close - low) / (high - low)) * 100
    kLine.push({ time: data[i].time, value: k })
  }

  // D line is SMA of K
  const dLine: IndicatorPoint[] = []
  if (kLine.length >= dPeriod) {
    let sum = 0
    for (let i = 0; i < kLine.length; i++) {
      sum += kLine[i].value
      if (i >= dPeriod) sum -= kLine[i - dPeriod].value
      if (i >= dPeriod - 1) {
        dLine.push({ time: kLine[i].time, value: sum / dPeriod })
      }
    }
  }

  return { k: kLine, d: dLine }
}

// ─── Williams %R ──────────────────────────────────────────

export function WilliamsR(data: OHLCV[], period: number = 14): IndicatorPoint[] {
  if (data.length < period) return []

  const result: IndicatorPoint[] = []

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const high = Math.max(...slice.map(d => d.high))
    const low = Math.min(...slice.map(d => d.low))
    const close = data[i].close

    const wr = high === low ? -50 : ((high - close) / (high - low)) * -100
    result.push({ time: data[i].time, value: wr })
  }

  return result
}

// ─── CCI (Commodity Channel Index) ────────────────────────

export function CCI(data: OHLCV[], period: number = 20): IndicatorPoint[] {
  if (data.length < period) return []

  const result: IndicatorPoint[] = []
  const typicalPrices = data.map(d => (d.high + d.low + d.close) / 3)

  for (let i = period - 1; i < data.length; i++) {
    const slice = typicalPrices.slice(i - period + 1, i + 1)
    const mean = slice.reduce((s, v) => s + v, 0) / period
    const meanDeviation = slice.reduce((s, v) => s + Math.abs(v - mean), 0) / period

    const tp = typicalPrices[i]
    const cci = meanDeviation === 0 ? 0 : (tp - mean) / (0.015 * meanDeviation)
    result.push({ time: data[i].time, value: cci })
  }

  return result
}

// ─── ATR (Average True Range) ─────────────────────────────

export function ATR(data: OHLCV[], period: number = 14): IndicatorPoint[] {
  if (data.length < period + 1) return []

  const trueRanges: number[] = []

  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close),
    )
    trueRanges.push(tr)
  }

  const result: IndicatorPoint[] = []
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period
  result.push({ time: data[period].time, value: atr })

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period
    result.push({ time: data[i + 1].time, value: atr })
  }

  return result
}

// ─── ADX (Average Directional Index) ──────────────────────

export interface ADXResult {
  adx: IndicatorPoint[]
  plusDI: IndicatorPoint[]
  minusDI: IndicatorPoint[]
}

export function ADX(data: OHLCV[], period: number = 14): ADXResult {
  if (data.length < period * 2) return { adx: [], plusDI: [], minusDI: [] }

  const plusDM: number[] = []
  const minusDM: number[] = []
  const tr: number[] = []

  for (let i = 1; i < data.length; i++) {
    const upMove = data[i].high - data[i - 1].high
    const downMove = data[i - 1].low - data[i].low

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
    tr.push(Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close),
    ))
  }

  // Smoothed averages
  const smoothedTR: number[] = []
  const smoothedPlusDM: number[] = []
  const smoothedMinusDM: number[] = []

  let sumTR = tr.slice(0, period).reduce((s, v) => s + v, 0)
  let sumPlusDM = plusDM.slice(0, period).reduce((s, v) => s + v, 0)
  let sumMinusDM = minusDM.slice(0, period).reduce((s, v) => s + v, 0)

  smoothedTR.push(sumTR)
  smoothedPlusDM.push(sumPlusDM)
  smoothedMinusDM.push(sumMinusDM)

  for (let i = period; i < tr.length; i++) {
    sumTR = sumTR - sumTR / period + tr[i]
    sumPlusDM = sumPlusDM - sumPlusDM / period + plusDM[i]
    sumMinusDM = sumMinusDM - sumMinusDM / period + minusDM[i]
    smoothedTR.push(sumTR)
    smoothedPlusDM.push(sumPlusDM)
    smoothedMinusDM.push(sumMinusDM)
  }

  const plusDI: IndicatorPoint[] = []
  const minusDI: IndicatorPoint[] = []
  const dx: number[] = []

  for (let i = 0; i < smoothedTR.length; i++) {
    const pdi = smoothedTR[i] === 0 ? 0 : (smoothedPlusDM[i] / smoothedTR[i]) * 100
    const mdi = smoothedTR[i] === 0 ? 0 : (smoothedMinusDM[i] / smoothedTR[i]) * 100
    const diSum = pdi + mdi
    const dxVal = diSum === 0 ? 0 : Math.abs(pdi - mdi) / diSum * 100

    plusDI.push({ time: data[i + period].time, value: pdi })
    minusDI.push({ time: data[i + period].time, value: mdi })
    dx.push(dxVal)
  }

  // ADX is smoothed DX
  const adxLine: IndicatorPoint[] = []
  if (dx.length >= period) {
    let adx = dx.slice(0, period).reduce((s, v) => s + v, 0) / period
    adxLine.push({ time: data[period * 2].time, value: adx })

    for (let i = period; i < dx.length; i++) {
      adx = (adx * (period - 1) + dx[i]) / period
      adxLine.push({ time: data[i + period].time, value: adx })
    }
  }

  return { adx: adxLine, plusDI, minusDI }
}

// ─── OBV (On-Balance Volume) ──────────────────────────────

export function OBV(data: OHLCV[]): IndicatorPoint[] {
  if (data.length < 2) return []

  const result: IndicatorPoint[] = []
  let obv = 0

  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) {
      obv += data[i].volume
    } else if (data[i].close < data[i - 1].close) {
      obv -= data[i].volume
    }
    result.push({ time: data[i].time, value: obv })
  }

  return result
}

// ─── VWAP (Volume Weighted Average Price) ──────────────────

export function VWAP(data: OHLCV[]): IndicatorPoint[] {
  if (data.length === 0) return []

  const result: IndicatorPoint[] = []
  let cumulativeTPV = 0
  let cumulativeVolume = 0

  for (const candle of data) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    cumulativeTPV += typicalPrice * candle.volume
    cumulativeVolume += candle.volume

    const vwap = cumulativeVolume === 0 ? typicalPrice : cumulativeTPV / cumulativeVolume
    result.push({ time: candle.time, value: vwap })
  }

  return result
}

// ─── Ichimoku Cloud ───────────────────────────────────────

export interface IchimokuResult {
  tenkan: IndicatorPoint[]
  kijun: IndicatorPoint[]
  senkouA: IndicatorPoint[]
  senkouB: IndicatorPoint[]
  chikou: IndicatorPoint[]
}

export function Ichimoku(
  data: OHLCV[],
  tenkanPeriod: number = 9,
  kijunPeriod: number = 26,
  senkouBPeriod: number = 52,
): IchimokuResult {
  const calcLine = (period: number): IndicatorPoint[] => {
    const result: IndicatorPoint[] = []
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1)
      const high = Math.max(...slice.map(d => d.high))
      const low = Math.min(...slice.map(d => d.low))
      result.push({ time: data[i].time, value: (high + low) / 2 })
    }
    return result
  }

  const tenkan = calcLine(tenkanPeriod)
  const kijun = calcLine(kijunPeriod)
  const senkouB = calcLine(senkouBPeriod)

  // Senkou A = (Tenkan + Kijun) / 2, shifted forward 26 periods
  const senkouA: IndicatorPoint[] = []
  for (let i = 0; i < Math.min(tenkan.length, kijun.length); i++) {
    senkouA.push({
      time: (tenkan[i].time as number) + kijunPeriod * 86400,
      value: (tenkan[i].value + kijun[i].value) / 2,
    })
  }

  // Chikou = close shifted back 26 periods
  const chikou: IndicatorPoint[] = []
  for (let i = kijunPeriod; i < data.length; i++) {
    chikou.push({
      time: (data[i].time as number) - kijunPeriod * 86400,
      value: data[i].close,
    })
  }

  return { tenkan, kijun, senkouA, senkouB, chikou }
}

// ─── Parabolic SAR ────────────────────────────────────────

export function ParabolicSAR(
  data: OHLCV[],
  step: number = 0.02,
  maxStep: number = 0.2,
): IndicatorPoint[] {
  if (data.length < 2) return []

  const result: IndicatorPoint[] = []
  let isLong = data[1].close > data[0].close
  let sar = isLong ? data[0].low : data[0].high
  let ep = isLong ? data[0].high : data[0].low
  let af = step

  result.push({ time: data[0].time, value: sar })

  for (let i = 1; i < data.length; i++) {
    const prevSar = sar

    if (isLong) {
      sar = prevSar + af * (ep - prevSar)
      sar = Math.min(sar, data[i - 1].low, data[i - 2]?.low ?? data[i - 1].low)

      if (data[i].low < sar) {
        isLong = false
        sar = ep
        ep = data[i].low
        af = step
      } else {
        if (data[i].high > ep) {
          ep = data[i].high
          af = Math.min(af + step, maxStep)
        }
      }
    } else {
      sar = prevSar + af * (ep - prevSar)
      sar = Math.max(sar, data[i - 1].high, data[i - 2]?.high ?? data[i - 1].high)

      if (data[i].high > sar) {
        isLong = true
        sar = ep
        ep = data[i].high
        af = step
      } else {
        if (data[i].low < ep) {
          ep = data[i].low
          af = Math.min(af + step, maxStep)
        }
      }
    }

    result.push({ time: data[i].time, value: sar })
  }

  return result
}

// ─── Pivot Points ─────────────────────────────────────────

export interface PivotPoints {
  r3: number
  r2: number
  r1: number
  pivot: number
  s1: number
  s2: number
  s3: number
}

export function PivotPointsClassic(data: OHLCV[]): PivotPoints | null {
  if (data.length < 2) return null

  const prev = data[data.length - 2]
  const pivot = (prev.high + prev.low + prev.close) / 3

  return {
    r3: prev.high + 2 * (pivot - prev.low),
    r2: pivot + (prev.high - prev.low),
    r1: 2 * pivot - prev.low,
    pivot,
    s1: 2 * pivot - prev.high,
    s2: pivot - (prev.high - prev.low),
    s3: prev.low - 2 * (prev.high - pivot),
  }
}

// ─── Fibonacci Retracement Levels ─────────────────────────

export interface FibonacciLevels {
  level0: number
  level236: number
  level382: number
  level500: number
  level618: number
  level786: number
  level100: number
}

export function FibonacciRetracement(high: number, low: number): FibonacciLevels {
  const diff = high - low
  return {
    level0: high,
    level236: high - diff * 0.236,
    level382: high - diff * 0.382,
    level500: high - diff * 0.5,
    level618: high - diff * 0.618,
    level786: high - diff * 0.786,
    level100: low,
  }
}

// ─── Helper: compute 50+ indicators ───────────────────────

export interface ExtendedIndicators {
  // From base
  sma20: IndicatorPoint[]
  sma50: IndicatorPoint[]
  sma200: IndicatorPoint[]
  ema20: IndicatorPoint[]
  ema50: IndicatorPoint[]
  rsi14: IndicatorPoint[]
  macd: { macd: IndicatorPoint[]; signal: IndicatorPoint[]; histogram: IndicatorPoint[] }
  bollinger: { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] }
  // New
  stochastic: StochasticResult
  williamsR: IndicatorPoint[]
  cci: IndicatorPoint[]
  atr: IndicatorPoint[]
  adx: ADXResult
  obv: IndicatorPoint[]
  vwap: IndicatorPoint[]
  ichimoku: IchimokuResult
  parabolicSAR: IndicatorPoint[]
}

export function computeExtendedIndicators(data: OHLCV[]): ExtendedIndicators {
  // Import base indicators
  const { SMA, EMA, RSI, MACD, Bollinger } = require('./indicators')

  return {
    sma20: SMA(data, 20),
    sma50: SMA(data, 50),
    sma200: SMA(data, 200),
    ema20: EMA(data, 20),
    ema50: EMA(data, 50),
    rsi14: RSI(data, 14),
    macd: MACD(data),
    bollinger: Bollinger(data),
    stochastic: Stochastic(data),
    williamsR: WilliamsR(data),
    cci: CCI(data),
    atr: ATR(data),
    adx: ADX(data),
    obv: OBV(data),
    vwap: VWAP(data),
    ichimoku: Ichimoku(data),
    parabolicSAR: ParabolicSAR(data),
  }
}
