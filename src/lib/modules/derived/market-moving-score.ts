// ─────────────────────────────────────────────────────────────
// Market-Moving Score Engine
// Fuses multiple signals into a single composite score per asset
// ─────────────────────────────────────────────────────────────


import type { NormalizedSignal, SignalTier, MarketVertical } from '@/lib/modules/market/types'
import { DEFAULT_TIER_WEIGHTS } from '@/lib/modules/market/types'
import { getEnabledProviders } from '@/lib/config/market-sources'
import { binanceFundingProvider } from '@/lib/modules/market/provider/binance-funding'
import { binanceOIProvider } from '@/lib/modules/market/provider/binance-oi'
import { binanceLiquidationsProvider } from '@/lib/modules/market/provider/binance-liquidations'
import { binanceLsRatioProvider } from '@/lib/modules/market/provider/binance-ls-ratio'
import { deribitOptionsProvider } from '@/lib/modules/market/provider/deribit-options'
import { alternativeMeProvider } from '@/lib/modules/market/provider/alternative-me'

// Provider registry
const PROVIDERS: Record<string, { fetch: (symbol: string, market: MarketVertical) => Promise<NormalizedSignal | null> }> = {
  'binance-funding': { fetch: (s, m) => binanceFundingProvider.fetchSignal(s, m) },
  'binance-oi': { fetch: (s, m) => binanceOIProvider.fetchSignal(s, m) },
  'binance-liquidations': { fetch: (s, m) => binanceLiquidationsProvider.fetchSignal(s, m) },
  'binance-ls-ratio': { fetch: (s, m) => binanceLsRatioProvider.fetchSignal(s, m) },
  'deribit-options': { fetch: (s, m) => deribitOptionsProvider.fetchSignal(s, m) },
  'alternative-me': { fetch: (s, m) => alternativeMeProvider.fetchSignal(s, m) },
}

export interface TierScore {
  tier: SignalTier
  score: number          // 0-100 weighted average
  confidence: number     // 0-1
  signalCount: number
  topSignal: string      // Human-readable top contributor
}

export interface MarketMovingScore {
  symbol: string
  market: MarketVertical
  compositeScore: number     // 0-100
  direction: 'bullish' | 'bearish' | 'neutral'
  confidence: number         // 0-1
  tierScores: TierScore[]
  topSignals: string[]       // Top 3 human-readable signals
  fetchedAt: string
  signals: NormalizedSignal[]
}

/**
 * Normalize a raw value to 0-100 using z-score against trailing window
 * For now, uses simple percentile mapping; can be enhanced with historical data
 */
function normalizeToPercentile(rawValue: number, min: number, max: number): number {
  if (max === min) return 50
  return Math.max(0, Math.min(100, ((rawValue - min) / (max - min)) * 100))
}

/**
 * Compute tier sub-score from signals in that tier
 */
function computeTierScore(signals: NormalizedSignal[], tier: SignalTier): TierScore {
  const tierSignals = signals.filter(s => s.tier === tier)
  if (tierSignals.length === 0) {
    return { tier, score: 50, confidence: 0, signalCount: 0, topSignal: 'No data' }
  }

  // Weighted average of normalized scores
  const totalWeight = tierSignals.reduce((sum, s) => sum + s.confidence, 0)
  const weightedScore = tierSignals.reduce((sum, s) => sum + (s.normalizedScore * s.confidence), 0) / totalWeight
  const avgConfidence = tierSignals.reduce((sum, s) => sum + s.confidence, 0) / tierSignals.length

  // Find top signal by confidence
  const topSignal = tierSignals.reduce((best, s) => s.confidence > best.confidence ? s : best)

  return {
    tier,
    score: Math.round(weightedScore),
    confidence: avgConfidence,
    signalCount: tierSignals.length,
    topSignal: topSignal.humanReadable,
  }
}

/**
 * Compute composite Market-Moving Score for a symbol
 */
export async function computeMarketMovingScore(
  symbol: string,
  market: MarketVertical = 'crypto_cex'
): Promise<MarketMovingScore> {
  const enabledProviders = getEnabledProviders(market)
  const signals: NormalizedSignal[] = []

  // Fetch signals from all enabled providers in parallel
  const fetchPromises = enabledProviders.map(async (providerId) => {
    const provider = PROVIDERS[providerId]
    if (!provider) return null
    try {
      return await provider.fetch(symbol, market)
    } catch {
      return null
    }
  })

  const results = await Promise.allSettled(fetchPromises)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      signals.push(r.value)
    }
  }

  // Compute tier scores
  const tiers: SignalTier[] = ['positioning', 'onchain', 'sentiment', 'macro', 'structure']
  const tierScores = tiers.map(t => computeTierScore(signals, t))

  // Compute composite score (weighted average of tier scores)
  const totalWeight = tierScores.reduce((sum, t) => sum + (DEFAULT_TIER_WEIGHTS[t.tier] * t.confidence), 0)
  const compositeScore = totalWeight > 0
    ? tierScores.reduce((sum, t) => sum + (t.score * DEFAULT_TIER_WEIGHTS[t.tier] * t.confidence), 0) / totalWeight
    : 50

  // Determine direction
  const direction = compositeScore > 60 ? 'bullish' : compositeScore < 40 ? 'bearish' : 'neutral'

  // Overall confidence (average of tier confidences, weighted by tier importance)
  const confidence = tierScores.reduce((sum, t) => sum + (t.confidence * DEFAULT_TIER_WEIGHTS[t.tier]), 0) /
    tierScores.reduce((sum, t) => sum + DEFAULT_TIER_WEIGHTS[t.tier], 0)

  // Top 3 human-readable signals
  const topSignals = signals
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map(s => s.humanReadable)

  return {
    symbol,
    market,
    compositeScore: Math.round(compositeScore),
    direction,
    confidence: Math.round(confidence * 100) / 100,
    tierScores,
    topSignals,
    fetchedAt: new Date().toISOString(),
    signals,
  }
}

/**
 * Compute scores for multiple symbols
 */
export async function computeBatchScores(
  symbols: string[],
  market: MarketVertical = 'crypto_cex'
): Promise<MarketMovingScore[]> {
  return Promise.all(symbols.map(s => computeMarketMovingScore(s, market)))
}
