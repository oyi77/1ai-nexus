// ─────────────────────────────────────────────────────────────
// Market Data Provider Types — Unified interface for all signals
// ─────────────────────────────────────────────────────────────

// OHLCV types (preserved from original)
export interface OHLCVCandle {
  time: number       // Unix timestamp (seconds)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type OHLCVInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M'

export interface OHLCVRequest {
  symbol: string
  interval: OHLCVInterval
  limit?: number
  from?: number
  to?: number
}

export interface OHLCVResponse {
  candles: OHLCVCandle[]
  symbol: string
  interval: OHLCVInterval
  provider: string
  cached: boolean
  timestamp: number
}

export interface OHLCVProvider {
  id: string
  name: string
  supports: ('crypto' | 'equity' | 'forex' | 'commodity' | 'index')[]
  fetchOHLCV(req: OHLCVRequest): Promise<OHLCVResponse>
  healthCheck(): Promise<boolean>
}

// Signal types (new)
export type SignalTier = 'positioning' | 'onchain' | 'sentiment' | 'macro' | 'structure'

export type MarketVertical = 'crypto_cex' | 'forex' | 'idx_bonds' | 'commodity' | 'binary' | 'deriv'

export interface NormalizedSignal {
  providerId: string
  tier: SignalTier
  symbol: string
  market: MarketVertical
  rawValue: number
  normalizedScore: number
  direction: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  fetchedAt: string
  sourceTimestamp: string
  humanReadable: string
}

export interface MarketDataProvider {
  readonly id: string
  readonly tier: SignalTier
  readonly supportedMarkets: MarketVertical[]
  fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null>
  isEnabled(market: MarketVertical): boolean
}

export interface ProviderConfig {
  enabled: boolean
  weight: number
  ttlMs: number
}

export const DEFAULT_TIER_WEIGHTS: Record<SignalTier, number> = {
  positioning: 0.35,
  onchain: 0.25,
  sentiment: 0.15,
  macro: 0.15,
  structure: 0.10,
}

export const DEFAULT_TIER_TTLS: Record<SignalTier, number> = {
  positioning: 60_000,
  onchain: 900_000,
  sentiment: 300_000,
  macro: 3600_000,
  structure: 300_000,
}
