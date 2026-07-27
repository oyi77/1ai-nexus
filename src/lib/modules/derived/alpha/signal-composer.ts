// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Signal Composer Pipeline
// Filtering, weighting, correlation, dedup & confirmation
// ─────────────────────────────────────────────────────────────

import type { AlphaSignal, Regime, SourcePerf } from './types'

/**
 * Drop signals from chronically underperforming sources
 */
export function applySourcePerformanceFiltering(
  enriched: AlphaSignal[],
  perfMap: Map<string, SourcePerf>,
): AlphaSignal[] {
  return enriched.filter((s) => {
    const src = s.sources[0] ?? ''
    const perf = perfMap.get(src)
    if (!perf) return true
    // Reliable: ≥100 samples with ≥48% win rate, or ≥40 samples with ≥40%
    if (perf.total >= 100) return perf.winRate >= 0.48
    if (perf.total >= 40) return perf.winRate >= 0.4
    return true // too few samples to judge
  })
}

/**
 * Scale strength by historical win rate (weighted by sample confidence)
 */
export function applyProportionalWeighting(
  filtered: AlphaSignal[],
  perfMap: Map<string, SourcePerf>,
): AlphaSignal[] {
  return filtered.map((s) => {
    const src = s.sources[0] ?? ''
    const perf = perfMap.get(src)
    if (!perf || perf.total < 20) return s
    const sampleConfidence = Math.min(1, perf.total / 100)
    const adjustment = (perf.winRate - 0.5) * 2 * sampleConfidence * 30
    return {
      ...s,
      strength: Math.max(
        5,
        Math.min(100, Math.round(s.strength + adjustment)),
      ),
      confidence: Math.max(
        5,
        Math.min(95, Math.round(s.confidence + adjustment * 0.5)),
      ),
    }
  })
}

/**
 * If BTC has a strong trend, kill non-aligned signals to prevent drawdown pileup.
 * Cap same-direction signals to top 5 to avoid concentration.
 */
export function applyCorrelationFilter(
  boosted: AlphaSignal[],
  regimeMap: Map<string, { regime: Regime; atr14: number }>,
): AlphaSignal[] {
  let bcFiltered = boosted
  const btcRegime = regimeMap.get('BTC')
  if (btcRegime && btcRegime.regime !== 'chop') {
    const btcBullish = btcRegime.regime === 'trend-bull'
    bcFiltered = boosted.filter(
      (s) =>
        s.symbol === 'BTC' ||
        (btcBullish
          ? s.direction === 'bullish'
          : s.direction === 'bearish'),
    )
  }
  bcFiltered.sort(
    (a, b) => b.strength * b.confidence - a.strength * a.confidence,
  )
  const caps = { bullish: 0, bearish: 0 }
  return bcFiltered.filter((s) => {
    if (caps.bullish + caps.bearish >= 15) return false
    const dir = s.direction as 'bullish' | 'bearish'
    return ++caps[dir] <= 5
  })
}

/**
 * Deduplicate by symbol+direction keeping highest signal,
 * require multiple agreeing sources OR high individual confidence,
 * filter to signals with valid trading levels, and return top 50.
 */
export function deduplicateAndConfirm(
  correlated: AlphaSignal[],
): AlphaSignal[] {
  // Count agreeing sources per symbol+direction
  const agreeCount = new Map<string, number>()
  for (const s of correlated) {
    const key = `${s.symbol}-${s.direction}`
    agreeCount.set(key, (agreeCount.get(key) ?? 0) + 1)
  }

  // Deduplicate: keep highest strength per symbol+direction
  // Require either multiple agreeing sources OR high individual confidence
  const deduped = new Map<string, AlphaSignal>()
  for (const s of correlated) {
    const key = `${s.symbol}-${s.direction}`
    const agree = agreeCount.get(key) ?? 0
    if (agree < 2 && s.confidence < 65) continue // need confirmation
    const existing = deduped.get(key)
    if (
      !existing ||
      s.strength * s.confidence > existing.strength * existing.confidence
    ) {
      deduped.set(key, s)
    }
  }

  // Filter: only return signals with valid trading levels
  const valid = Array.from(deduped.values()).filter(
    (s) => s.entry && s.sl && s.tp1,
  )

  // Sort by strength * confidence
  valid.sort(
    (a, b) => b.strength * b.confidence - a.strength * a.confidence,
  )

  return valid.slice(0, 50)
}
