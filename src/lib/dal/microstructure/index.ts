// ─────────────────────────────────────────────────────────────
// Microstructure / Secret Alpha — DAL registry entry point
// §4 — aggregates kimchi, cross-exchange basis, weekend gaps
// ─────────────────────────────────────────────────────────────

export { getKimchiPremium, getKimchiHistory, getKimchiZScore } from './kimchi-premium'
export type { KimchiPremium, KimchiHistoryPoint } from './kimchi-premium'

export { getCrossExchangeBasis, getAllBases } from './cross-exchange'
export type { BasisSpread, ExchangeSpotPrice } from './cross-exchange'

export { getWeekendGap, getWeekendDriftCorrelation } from './weekend-gap'
export type { WeekendGap } from './weekend-gap'

import { getKimchiPremium } from './kimchi-premium'
import { getAllBases } from './cross-exchange'
import { getWeekendGap, getWeekendDriftCorrelation } from './weekend-gap'

export interface GapSignalEntry {
  pairLabel: string
  venueA: string
  venueB: string
  priceA: number
  priceB: number
  spreadPct: number
  zScore: number
  alert: boolean
  source: string
  timestamp: number
}

/**
 * Gather all microstructure signals, ranked by |zScore| descending.
 */
export async function getAllGapSignals(): Promise<GapSignalEntry[]> {
  const [kimchiResult, basisResult, weekendBtcResult, weekendEthResult] = await Promise.allSettled([
    getKimchiPremium(),
    getAllBases(),
    getWeekendGap('BTCUSDT'),
    getWeekendGap('ETHUSDT'),
  ])

  const signals: GapSignalEntry[] = []

  // Kimchi premiums
  if (kimchiResult.status === 'fulfilled') {
    for (const k of kimchiResult.value) {
      signals.push({
        pairLabel: `${k.asset}/KRW Kimchi`,
        venueA: 'Upbit',
        venueB: 'Binance',
        priceA: k.krwPriceUsd,
        priceB: k.globalPriceUsd,
        spreadPct: k.premiumPct,
        zScore: k.zScore,
        alert: k.alert,
        source: 'kimchi',
        timestamp: k.timestamp,
      })
    }
  }

  // Cross-exchange basis
  if (basisResult.status === 'fulfilled') {
    for (const b of basisResult.value) {
      signals.push({
        pairLabel: b.symbol.replace('USDT', ''),
        venueA: b.venueA,
        venueB: b.venueB,
        priceA: b.priceA,
        priceB: b.priceB,
        spreadPct: b.spreadPct,
        zScore: b.zScore,
        alert: b.alert,
        source: 'basis',
        timestamp: b.timestamp,
      })
    }
  }

  // Weekend gaps
  for (const result of [weekendBtcResult, weekendEthResult]) {
    if (result.status === 'fulfilled' && result.value) {
      const w = result.value
      signals.push({
        pairLabel: `${w.symbol.replace('USDT', '')}/USD Weekend`,
        venueA: 'Fri Close',
        venueB: 'Mon Open',
        priceA: w.fridayClose,
        priceB: w.mondayOpen,
        spreadPct: w.gapPct,
        zScore: w.zScore,
        alert: w.alert,
        source: 'weekend',
        timestamp: w.timestamp,
      })
    }
  }

  // Sort by absolute z-score descending — largest dislocations first
  signals.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
  return signals
}
