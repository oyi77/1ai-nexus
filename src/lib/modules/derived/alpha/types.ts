// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Types & Interfaces
// ─────────────────────────────────────────────────────────────

export type ValidPeriod = '4h' | '24h' | '7d'

export interface AlphaSignal {
  id: string
  symbol: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  sources: string[]
  reasoning: string
  timestamp: number
  // Trading levels
  entry: number | null
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  validPeriod: ValidPeriod
  expiresAt: number
}

export interface PriceData {
  symbol: string
  price: number
  high24h: number
  low24h: number
}

export interface KlinesData {
  symbol: string
  closes: number[]
  highs: number[]
  lows: number[]
}

export type Regime = 'trend-bull' | 'trend-bear' | 'chop'

export interface RegimeInfo {
  regime: Regime
  atr14: number
}

export interface SourcePerf {
  total: number
  winRate: number
}

/** Partial signal before trading levels and validity are computed */
export type PartialSignal = Omit<AlphaSignal, 'entry' | 'tp1' | 'tp2' | 'tp3' | 'sl' | 'validPeriod' | 'expiresAt'>
