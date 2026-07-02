// ─────────────────────────────────────────────────────────────
// Alternative.me Fear & Greed Index Provider
// Contrarian signal: extreme fear = buy, extreme greed = sell
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface FearGreedData {
  value: number
  classification: string
  timestamp: number
}

async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=2', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null

    const data = (await res.json()) as {
      data?: Array<{ value: string; value_classification: string; timestamp: string }>
    }

    const current = data.data?.[0]
    if (!current) return null

    return {
      value: parseInt(current.value),
      classification: current.value_classification,
      timestamp: parseInt(current.timestamp) * 1000,
    }
  } catch {
    return null
  }
}

// Fear & Greed is a contrarian signal
// Extreme Fear (<20) = bullish (buy when others are fearful)
// Extreme Greed (>80) = bearish (sell when others are greedy)
function getDirection(value: number): 'bullish' | 'bearish' | 'neutral' {
  if (value < 25) return 'bullish'
  if (value > 75) return 'bearish'
  return 'neutral'
}

function getHumanReadable(data: FearGreedData): string {
  const arrows = data.value < 25 ? '↑' : data.value > 75 ? '↓' : '→'
  return `Fear & Greed: ${data.value}/100 (${data.classification}) ${arrows}`
}

class AlternativeMeProvider implements MarketDataProvider {
  readonly id = 'alternative-me'
  readonly tier = 'sentiment' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: fg } = await getCached('fear-greed', config.ttlMs, fetchFearGreed)
    if (!fg) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: 'BTC', // F&G is market-wide, primarily BTC
      market,
      rawValue: fg.value,
      normalizedScore: fg.value, // Already 0-100
      direction: getDirection(fg.value),
      confidence: 0.7,
      fetchedAt: now,
      sourceTimestamp: new Date(fg.timestamp).toISOString(),
      humanReadable: getHumanReadable(fg),
    }
  }
}

export const alternativeMeProvider = new AlternativeMeProvider()
