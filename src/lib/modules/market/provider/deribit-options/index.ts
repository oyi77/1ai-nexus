// ─────────────────────────────────────────────────────────────
// Deribit Options Positioning Provider
// Put/call OI ratio, max pain, 25-delta skew
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface OptionsData {
  symbol: string
  putCallRatio: number
  maxPain: number
  currentPrice: number
  skew25d: number
}

// Fetch options data from Deribit
async function fetchDeribitOptions(): Promise<OptionsData[]> {
  const results: OptionsData[] = []

  for (const currency of ['BTC', 'ETH']) {
    try {
      // Get book summary for options
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`,
        { signal: AbortSignal.timeout(10_000) }
      )
      if (!res.ok) continue

      const data = (await res.json()) as {
        result?: Array<{
          instrument_name: string
          open_interest: number
          put_call: string
          underlying_price: number
        }>
      }

      const options = data.result ?? []
      let putOI = 0, callOI = 0
      let currentPrice = 0

      for (const opt of options) {
        if (opt.put_call === 'put') putOI += opt.open_interest
        else callOI += opt.open_interest
        if (opt.underlying_price > 0) currentPrice = opt.underlying_price
      }

      const putCallRatio = callOI > 0 ? putOI / callOI : 1

      // Simplified max pain (would need strike-level data for real calc)
      results.push({
        symbol: currency,
        putCallRatio,
        maxPain: currentPrice * 0.95, // Placeholder
        currentPrice,
        skew25d: 0, // Would need vol surface data
      })
    } catch { /* skip */ }
  }

  return results
}

function normalizePutCallRatio(ratio: number): number {
  // ratio > 1 = more puts (bearish), < 1 = more calls (bullish)
  // Map 0.5..2.0 to 100..0 (inverted — high put ratio = bearish = low score)
  const clamped = Math.max(0.5, Math.min(2.0, ratio))
  return ((2.0 - clamped) / 1.5) * 100
}

function getDirection(ratio: number): 'bullish' | 'bearish' | 'neutral' {
  if (ratio < 0.8) return 'bullish'  // More calls than puts
  if (ratio > 1.2) return 'bearish'  // More puts than calls
  return 'neutral'
}

function getHumanReadable(data: OptionsData): string {
  const ratioStr = data.putCallRatio.toFixed(2)
  if (data.putCallRatio > 1.5) return `${data.symbol} options: put/call ${ratioStr} — heavy hedging, fear`
  if (data.putCallRatio > 1.2) return `${data.symbol} options: put/call ${ratioStr} — cautious sentiment`
  if (data.putCallRatio < 0.7) return `${data.symbol} options: put/call ${ratioStr} — call-heavy, greed`
  if (data.putCallRatio < 0.8) return `${data.symbol} options: put/call ${ratioStr} — optimistic positioning`
  return `${data.symbol} options: put/call ${ratioStr} — balanced`
}

class DeribitOptionsProvider implements MarketDataProvider {
  readonly id = 'deribit-options'
  readonly tier = 'positioning' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: options } = await getCached('deribit:options', config.ttlMs, fetchDeribitOptions)
    const opt = options.find(o => o.symbol === symbol)

    if (!opt) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: `${symbol}USDT`,
      market,
      rawValue: opt.putCallRatio,
      normalizedScore: normalizePutCallRatio(opt.putCallRatio),
      direction: getDirection(opt.putCallRatio),
      confidence: 0.75,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(opt),
    }
  }
}

export const deribitOptionsProvider = new DeribitOptionsProvider()
