// ─────────────────────────────────────────────────────────────
// CoinGecko Trending Provider
// Trending coins = crowd attention = sentiment signal
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface TrendingCoin {
  name: string
  symbol: string
  score: number
}

interface TrendingData {
  coins: TrendingCoin[]
  marketCapChange24h: number
  btcDominance: number
}

async function fetchTrending(): Promise<TrendingData | null> {
  try {
    const [trendingRes, globalRes] = await Promise.all([
      fetch('https://api.coingecko.com/api/v3/search/trending', {
        signal: AbortSignal.timeout(10_000),
      }),
      fetch('https://api.coingecko.com/api/v3/global', {
        signal: AbortSignal.timeout(10_000),
      }),
    ])

    if (!trendingRes.ok) return null

    const trending = (await trendingRes.json()) as {
      coins?: Array<{ item?: { name?: string; symbol?: string; score?: number } }>
    }

    let marketCapChange = 0
    let btcDom = 0
    if (globalRes.ok) {
      const global = (await globalRes.json()) as {
        data?: { market_cap_change_percentage_24h_usd?: number; market_cap_percentage?: { btc?: number } }
      }
      marketCapChange = global.data?.market_cap_change_percentage_24h_usd ?? 0
      btcDom = global.data?.market_cap_percentage?.btc ?? 0
    }

    return {
      coins: (trending.coins ?? []).map(c => ({
        name: c.item?.name ?? '',
        symbol: c.item?.symbol ?? '',
        score: c.item?.score ?? 0,
      })),
      marketCapChange24h: marketCapChange,
      btcDominance: btcDom,
    }
  } catch {
    return null
  }
}

// Sentiment: market cap change = crowd sentiment proxy
function getDirection(marketCapChange: number): 'bullish' | 'bearish' | 'neutral' {
  if (marketCapChange > 3) return 'bullish'
  if (marketCapChange < -3) return 'bearish'
  return 'neutral'
}

function normalizeMarketChange(change: number): number {
  // -10% to +10% maps to 0-100
  const clamped = Math.max(-10, Math.min(10, change))
  return ((clamped + 10) / 20) * 100
}

function getHumanReadable(data: TrendingData): string {
  const top3 = data.coins.slice(0, 3).map(c => c.symbol).join(', ')
  const change = data.marketCapChange24h > 0 ? '+' : ''
  return `Trending: ${top3} · Market ${change}${data.marketCapChange24h.toFixed(1)}% · BTC dom ${data.btcDominance.toFixed(1)}%`
}

class CoinGeckoTrendingProvider implements MarketDataProvider {
  readonly id = 'coingecko-trending'
  readonly tier = 'sentiment' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: trending } = await getCached('coingecko:trending', config.ttlMs, fetchTrending)
    if (!trending) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: 'BTC', // Market-wide
      market,
      rawValue: trending.marketCapChange24h,
      normalizedScore: normalizeMarketChange(trending.marketCapChange24h),
      direction: getDirection(trending.marketCapChange24h),
      confidence: 0.6,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(trending),
    }
  }
}

export const coingeckoTrendingProvider = new CoinGeckoTrendingProvider()
