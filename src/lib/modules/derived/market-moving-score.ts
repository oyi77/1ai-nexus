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
import { stablecoinSupplyProvider } from '@/lib/modules/market/provider/stablecoin-supply'
import { dexVolumeProvider } from '@/lib/modules/market/provider/dex-volume'
import { fredCalendarProvider } from '@/lib/modules/market/provider/fred-calendar'
import { whaleTransfersProvider } from '@/lib/modules/market/provider/whale-transfers'
import { coingeckoTrendingProvider } from '@/lib/modules/market/provider/coingecko-trending'

// Provider registry — all implemented providers
const PROVIDERS: Record<string, { fetch: (symbol: string, market: MarketVertical) => Promise<NormalizedSignal | null> }> = {
  // Tier 1: Positioning
  'binance-funding': { fetch: (s, m) => binanceFundingProvider.fetchSignal(s, m) },
  'binance-oi': { fetch: (s, m) => binanceOIProvider.fetchSignal(s, m) },
  'binance-liquidations': { fetch: (s, m) => binanceLiquidationsProvider.fetchSignal(s, m) },
  'binance-ls-ratio': { fetch: (s, m) => binanceLsRatioProvider.fetchSignal(s, m) },
  'deribit-options': { fetch: (s, m) => deribitOptionsProvider.fetchSignal(s, m) },
  // Tier 1: Sentiment
  'alternative-me': { fetch: (s, m) => alternativeMeProvider.fetchSignal(s, m) },
  // Tier 2: On-chain
  'stablecoin-supply': { fetch: (s, m) => stablecoinSupplyProvider.fetchSignal(s, m) },
  'dex-volume': { fetch: (s, m) => dexVolumeProvider.fetchSignal(s, m) },
  'whale-transfers': { fetch: (s, m) => whaleTransfersProvider.fetchSignal(s, m) },
  // Tier 4: Macro
  'fred-calendar': { fetch: (s, m) => fredCalendarProvider.fetchSignal(s, m) },
  // Sentiment (free)
  'coingecko-trending': { fetch: (s, m) => coingeckoTrendingProvider.fetchSignal(s, m) },
}

export interface TierScore {
  tier: SignalTier
  score: number
  confidence: number
  signalCount: number
  topSignal: string
}

export interface MarketMovingScore {
  symbol: string
  market: MarketVertical
  compositeScore: number
  direction: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  tierScores: TierScore[]
  topSignals: string[]
  fetchedAt: string
  signals: NormalizedSignal[]
}

function computeTierScore(signals: NormalizedSignal[], tier: SignalTier): TierScore {
  const tierSignals = signals.filter(s => s.tier === tier)
  if (tierSignals.length === 0) {
    return { tier, score: 50, confidence: 0, signalCount: 0, topSignal: 'No data' }
  }

  const totalWeight = tierSignals.reduce((sum, s) => sum + s.confidence, 0)
  const weightedScore = tierSignals.reduce((sum, s) => sum + (s.normalizedScore * s.confidence), 0) / totalWeight
  const avgConfidence = tierSignals.reduce((sum, s) => sum + s.confidence, 0) / tierSignals.length
  const topSignal = tierSignals.reduce((best, s) => s.confidence > best.confidence ? s : best)

  return {
    tier,
    score: Math.round(weightedScore),
    confidence: avgConfidence,
    signalCount: tierSignals.length,
    topSignal: topSignal.humanReadable,
  }
}

export async function computeMarketMovingScore(
  symbol: string,
  market: MarketVertical = 'crypto_cex'
): Promise<MarketMovingScore> {
  const enabledProviders = getEnabledProviders(market)
  const signals: NormalizedSignal[] = []

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

  const tiers: SignalTier[] = ['positioning', 'onchain', 'sentiment', 'macro', 'structure']
  const tierScores = tiers.map(t => computeTierScore(signals, t))

  const totalWeight = tierScores.reduce((sum, t) => sum + (DEFAULT_TIER_WEIGHTS[t.tier] * t.confidence), 0)
  const compositeScore = totalWeight > 0
    ? tierScores.reduce((sum, t) => sum + (t.score * DEFAULT_TIER_WEIGHTS[t.tier] * t.confidence), 0) / totalWeight
    : 50

  const direction = compositeScore > 60 ? 'bullish' : compositeScore < 40 ? 'bearish' : 'neutral'
  const confidence = tierScores.reduce((sum, t) => sum + (t.confidence * DEFAULT_TIER_WEIGHTS[t.tier]), 0) /
    tierScores.reduce((sum, t) => sum + DEFAULT_TIER_WEIGHTS[t.tier], 0)

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

export async function computeBatchScores(
  symbols: string[],
  market: MarketVertical = 'crypto_cex'
): Promise<MarketMovingScore[]> {
  return Promise.all(symbols.map(s => computeMarketMovingScore(s, market)))
}
