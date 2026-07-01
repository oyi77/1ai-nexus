// ─────────────────────────────────────────────────────────────
// Unified Intelligence Score Engine
// Combines all 14 modules into a single 0-100 intelligence score
// Breakdown by category: derivatives, macro, sentiment, on-chain
// Uses the existing composite-signals module for cross-module analysis
// ─────────────────────────────────────────────────────────────

import { evaluateCompositeSignals, CompositeSignal } from './composite-signals'

export interface IntelligenceScore {
  overall: number // 0-100
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F'
  regime: 'bullish' | 'bearish' | 'neutral'
  components: {
    derivatives: { score: number; signals: string[] }
    macro: { score: number; signals: string[] }
    sentiment: { score: number; signals: string[] }
    onChain: { score: number; signals: string[] }
  }
  compositeSignals: CompositeSignal[]
  timestamp: string
}

function scoreToGrade(score: number): IntelligenceScore['grade'] {
  if (score >= 95) return 'A+'
  if (score >= 85) return 'A'
  if (score >= 75) return 'B+'
  if (score >= 65) return 'B'
  if (score >= 55) return 'C+'
  if (score >= 45) return 'C'
  if (score >= 30) return 'D'
  return 'F'
}

export async function computeIntelligenceScore(): Promise<IntelligenceScore> {
  const composites = await evaluateCompositeSignals()

  // Aggregate signal direction across all composite signals
  let bullishCount = 0
  let bearishCount = 0
  const allSignals: string[] = []

  for (const signal of composites) {
    if (signal.direction === 'bullish') bullishCount++
    else if (signal.direction === 'bearish') bearishCount++
    allSignals.push(`${signal.name}: ${signal.description}`)
  }

  // Derivatives component — from composite signals that involve derivatives
  const derivSignals = composites.filter(s =>
    s.components.some(c => c.module.includes('funding') || c.module.includes('derivatives') || c.module.includes('open_interest'))
  )
  const derivativesScore = derivSignals.length > 0
    ? Math.round(derivSignals.reduce((s, sig) => s + (sig.direction === 'bullish' ? sig.strength : sig.direction === 'bearish' ? 100 - sig.strength : 50), 0) / derivSignals.length)
    : 50
  const derivativesSigs = derivSignals.map(s => `${s.name}: ${s.description}`)

  // Macro component — ETF flows, premiums, bonds
  const macroSignals = composites.filter(s =>
    s.components.some(c => c.module.includes('etf') || c.module.includes('premium') || c.module.includes('bond') || c.module.includes('treasury'))
  )
  const macroScore = macroSignals.length > 0
    ? Math.round(macroSignals.reduce((s, sig) => s + (sig.direction === 'bullish' ? sig.strength : sig.direction === 'bearish' ? 100 - sig.strength : 50), 0) / macroSignals.length)
    : 50
  const macroSigs = macroSignals.map(s => `${s.name}: ${s.description}`)

  // Sentiment component — Fear & Greed, narrative, news
  const sentimentSignals = composites.filter(s =>
    s.components.some(c => c.module.includes('sentiment') || c.module.includes('fear') || c.module.includes('narrative') || c.module.includes('news'))
  )
  const sentimentScore = sentimentSignals.length > 0
    ? Math.round(sentimentSignals.reduce((s, sig) => s + (sig.direction === 'bullish' ? sig.strength : sig.direction === 'bearish' ? 100 - sig.strength : 50), 0) / sentimentSignals.length)
    : 50
  const sentimentSigs = sentimentSignals.map(s => `${s.name}: ${s.description}`)

  // On-chain component — staking, miner, credit, whale
  const onChainSignals = composites.filter(s =>
    s.components.some(c => c.module.includes('staking') || c.module.includes('miner') || c.module.includes('credit') || c.module.includes('whale') || c.module.includes('exchange'))
  )
  const onChainScore = onChainSignals.length > 0
    ? Math.round(onChainSignals.reduce((s, sig) => s + (sig.direction === 'bullish' ? sig.strength : sig.direction === 'bearish' ? 100 - sig.strength : 50), 0) / onChainSignals.length)
    : 50
  const onChainSigs = onChainSignals.map(s => `${s.name}: ${s.description}`)

  // Overall score (weighted average of 4 components)
  const overall = Math.round(
    derivativesScore * 0.25 +
    macroScore * 0.25 +
    sentimentScore * 0.25 +
    onChainScore * 0.25
  )

  // Regime from consensus of composite signals
  const regime: IntelligenceScore['regime'] = bullishCount > bearishCount + 1
    ? 'bullish'
    : bearishCount > bullishCount + 1
    ? 'bearish'
    : 'neutral'

  return {
    overall: Math.max(0, Math.min(100, overall)),
    grade: scoreToGrade(overall),
    regime,
    components: {
      derivatives: { score: Math.max(0, Math.min(100, derivativesScore)), signals: derivativesSigs },
      macro: { score: Math.max(0, Math.min(100, macroScore)), signals: macroSigs },
      sentiment: { score: Math.max(0, Math.min(100, sentimentScore)), signals: sentimentSigs },
      onChain: { score: Math.max(0, Math.min(100, onChainScore)), signals: onChainSigs },
    },
    compositeSignals: composites,
    timestamp: new Date().toISOString(),
  }
}
