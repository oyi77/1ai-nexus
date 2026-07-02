// ─────────────────────────────────────────────────────────────
// Binance Order Book Depth Provider
// Bid/ask volume imbalance ratio — measures buying vs selling pressure
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface OrderBookLevel {
  price: string
  qty: string
}

interface OrderBookResponse {
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
}

interface OrderBookImbalance {
  symbol: string
  bidVolume: number
  askVolume: number
  imbalance: number // 0-100, 50 = balanced, >50 = more bids
}

async function fetchOrderBook(symbol: string): Promise<OrderBookImbalance | null> {
  const url = `https://api.binance.com/api/v3/depth?symbol=${symbol}USDT&limit=20`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null

  const data = (await res.json()) as OrderBookResponse

  const bidVolume = data.bids.reduce((sum, lvl) => sum + parseFloat(lvl.qty), 0)
  const askVolume = data.asks.reduce((sum, lvl) => sum + parseFloat(lvl.qty), 0)
  const total = bidVolume + askVolume

  if (total === 0) return null

  const imbalance = (bidVolume / total) * 100

  return { symbol, bidVolume, askVolume, imbalance }
}

function getDirection(imbalance: number): 'bullish' | 'bearish' | 'neutral' {
  if (imbalance > 60) return 'bullish'   // More bids than asks — buying pressure
  if (imbalance < 40) return 'bearish'   // More asks than bids — selling pressure
  return 'neutral'
}

function getHumanReadable(imbalance: number, symbol: string): string {
  const bidPct = imbalance.toFixed(0)
  if (imbalance > 60) return `${symbol} order book: ${bidPct}% bid volume — buying pressure`
  if (imbalance < 40) return `${symbol} order book: ${bidPct}% bid volume — selling pressure`
  return `${symbol} order book: ${bidPct}% bid volume — balanced`
}

class BinanceOrderbookProvider implements MarketDataProvider {
  readonly id = 'binance-orderbook'
  readonly tier = 'structure' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const cacheKey = `orderbook:${symbol}`

    const { data: book } = await getCached(cacheKey, config.ttlMs, () =>
      fetchOrderBook(symbol),
    )
    if (!book) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: `${symbol}USDT`,
      market,
      rawValue: book.imbalance,
      normalizedScore: book.imbalance,
      direction: getDirection(book.imbalance),
      confidence: 0.6, // Order books can be spoofed
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(book.imbalance, symbol),
    }
  }
}

export const binanceOrderbookProvider = new BinanceOrderbookProvider()
