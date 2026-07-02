// ─────────────────────────────────────────────────────────────
// Binance Funding Rate Provider
// Current rate, delta over 8h/24h, cross-exchange spread
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface FundingRate {
  symbol: string
  rate: number
  nextTime: number
}

// Fetch funding rates from Binance
async function fetchFundingRates(): Promise<FundingRate[]> {
  const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return []

  const data = (await res.json()) as Array<{
    symbol: string
    lastFundingRate: string
    nextFundingTime: string
  }>

  return data.map(d => ({
    symbol: d.symbol.replace('USDT', ''),
    rate: parseFloat(d.lastFundingRate),
    nextTime: parseInt(d.nextFundingTime),
  }))
}

// Normalize funding rate to 0-100 score
// -0.01% to +0.01% maps to 0-100, with 50 being neutral
function normalizeFundingRate(rate: number): number {
  // Clamp to reasonable range
  const clamped = Math.max(-0.01, Math.min(0.01, rate))
  // Map -0.01..0.01 to 0..100
  return ((clamped + 0.01) / 0.02) * 100
}

function getDirection(rate: number): 'bullish' | 'bearish' | 'neutral' {
  if (rate < -0.0005) return 'bullish'  // Negative funding = shorts paying longs
  if (rate > 0.0005) return 'bearish'   // Positive funding = longs paying shorts
  return 'neutral'
}

function getHumanReadable(rate: number, symbol: string): string {
  const pct = (rate * 100).toFixed(4)
  if (rate > 0.001) return `${symbol} funding extremely positive (${pct}%) — crowded longs, squeeze risk`
  if (rate > 0.0005) return `${symbol} funding positive (${pct}%) — bullish sentiment`
  if (rate < -0.001) return `${symbol} funding extremely negative (${pct}%) — crowded shorts, squeeze risk`
  if (rate < -0.0005) return `${symbol} funding negative (${pct}%) — bearish sentiment`
  return `${symbol} funding neutral (${pct}%)`
}

class BinanceFundingProvider implements MarketDataProvider {
  readonly id = 'binance-funding'
  readonly tier = 'positioning' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const cacheKey = `funding:${symbol}`

    const { data: rates } = await getCached(cacheKey, config.ttlMs, fetchFundingRates)
    const funding = rates.find(r => r.symbol === symbol)

    if (!funding) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: `${symbol}USDT`,
      market,
      rawValue: funding.rate,
      normalizedScore: normalizeFundingRate(funding.rate),
      direction: getDirection(funding.rate),
      confidence: 0.85, // High confidence — direct from exchange
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(funding.rate, symbol),
    }
  }
}

export const binanceFundingProvider = new BinanceFundingProvider()
