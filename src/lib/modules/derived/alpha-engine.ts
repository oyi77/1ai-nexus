// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Orchestrator
// Gathers signals from all sources, enriches with market data,
// and pipes through the signal composer pipeline.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { getCached } from '@/lib/api/server-cache'
import type { AlphaSignal, Regime, SourcePerf } from './alpha/types'
import { computeATR14, detectRegime, calculateLevels, determineValidPeriod } from './alpha/indicators'
import { fetchCurrentPrices, fetchKlines } from './alpha/price-service'
import {
  sourceTradeFlow,
  sourceFundingRates,
  sourceOpenInterest,
  sourceFearGreed,
  sourceWhaleAlerts,
  sourceLiquidations,
  sourceExchangeFlows,
  sourceGasTracker,
  sourceStablecoinFlows,
  sourceDerivativesIntel,
} from './alpha/sources'
import {
  applySourcePerformanceFiltering,
  applyProportionalWeighting,
  applyCorrelationFilter,
  deduplicateAndConfirm,
} from './alpha/signal-composer'

async function fetchAlphaSignals(): Promise<AlphaSignal[]> {
  const now = Date.now()

  // ── Gather signals from all 10 sources ──────────────────────
  const sourcesResult = await Promise.all([
    sourceTradeFlow(now),
    sourceFundingRates(now),
    sourceOpenInterest(now),
    sourceFearGreed(now),
    sourceWhaleAlerts(now),
    sourceLiquidations(now),
    sourceExchangeFlows(now),
    sourceGasTracker(now),
    sourceStablecoinFlows(now),
    sourceDerivativesIntel(now),
  ])
  const allSignals = sourcesResult.flat()
  const symbols = [...new Set(allSignals.map((s) => s.symbol))]

  // ── Fetch Market Data & Enrich Signals ──────────────────────
  const [prices, klines] = await Promise.all([
    fetchCurrentPrices(symbols),
    fetchKlines(symbols),
  ])

  // Compute regime per symbol
  const regimeMap = new Map<string, { regime: Regime; atr14: number }>()
  klines.forEach((kd, sym) => {
    const atr14 = computeATR14(kd)
    const { regime } = detectRegime(kd)
    regimeMap.set(sym, { regime, atr14 })
  })

  // Period duration mapping
  const periodMs: Record<string, number> = {
    '4h': 4 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }

  // Enrich signals with trading levels
  const enriched: AlphaSignal[] = allSignals.map((s) => {
    const priceData = prices[s.symbol]
    const primarySource = s.sources[0] ?? 'trade-flow'
    const validPeriod = determineValidPeriod(primarySource, s.strength)
    const expiresAt = now + periodMs[validPeriod]

    let levels = null
    if (priceData) {
      const rm = regimeMap.get(s.symbol)
      const atr14 = rm?.atr14 ?? priceData.high24h - priceData.low24h
      const regime = rm?.regime ?? 'chop'
      const range = priceData.high24h - priceData.low24h
      if (atr14 > 0 && range > 0) {
        const pos = (priceData.price - priceData.low24h) / range
        if (
          !(s.direction === 'bullish' && pos > 0.85) &&
          !(s.direction === 'bearish' && pos < 0.15)
        ) {
          levels = calculateLevels(priceData.price, atr14, s.direction, regime)
        }
      }
    }

    return {
      ...s,
      entry: levels?.entry ?? null,
      tp1: levels?.tp1 ?? null,
      tp2: levels?.tp2 ?? null,
      tp3: levels?.tp3 ?? null,
      sl: levels?.sl ?? null,
      validPeriod,
      expiresAt,
    }
  })

  // ── Source Performance Filtering ──────────────────────────
  // Query historical win rates for each signal source
  const perfMap = new Map<string, SourcePerf>()
  try {
    const rows = await prisma.$queryRaw<
      Array<{ source: string; wins: bigint; losses: bigint }>
    >`
      SELECT source, COUNT(*)FILTER(WHERE outcome='win')as wins, COUNT(*)FILTER(WHERE outcome='loss')as losses
      FROM "BacktestResult" WHERE outcome IN ('win','loss') GROUP BY source
    `
    for (const r of rows) {
      const total = Number(r.wins) + Number(r.losses)
      perfMap.set(r.source, {
        total,
        winRate: total > 0 ? Number(r.wins) / total : 0.5,
      })
    }
  } catch {
    /* silent — keep all signals if query fails */
  }

  // ── Composer Pipeline ────────────────────────────────────────
  const filtered = applySourcePerformanceFiltering(enriched, perfMap)
  const boosted = applyProportionalWeighting(filtered, perfMap)
  const correlated = applyCorrelationFilter(boosted, regimeMap)
  const valid = deduplicateAndConfirm(correlated)

  return valid
}

export async function getAlphaSignals(): Promise<{
  signals: AlphaSignal[]
  sourceCount: number
  timestamp: number
}> {
  const { data, fromCache: _fromCache } = await getCached(
    'alpha-signals',
    30_000,
    fetchAlphaSignals,
  )
  return {
    signals: data,
    sourceCount: new Set(data.flatMap((s) => s.sources)).size,
    timestamp: Date.now(),
  }
}
