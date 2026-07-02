// ─────────────────────────────────────────────────────────────
// Whale Wallet Transfers Provider
// Large transfers to/from exchanges signal potential moves
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface WhaleTransfer {
  symbol: string
  amountUsd: number
  fromExchange: boolean
  toExchange: boolean
  timestamp: number
}

async function fetchWhaleTransfers(): Promise<WhaleTransfer[]> {
  try {
    const res = await fetch('http://localhost:4400/api/v1/whale-alert', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []

    const data = (await res.json()) as {
      data?: { items?: Array<{ symbol: string; usd: number; from: string; to: string }> }
    }

    return (data.data?.items ?? [])
      .filter(a => a.usd >= 5_000_000) // $5M+ transfers
      .map(a => ({
        symbol: a.symbol,
        amountUsd: a.usd,
        fromExchange: a.from.toLowerCase().includes('exchange') || a.from.toLowerCase().includes('binance'),
        toExchange: a.to.toLowerCase().includes('exchange') || a.to.toLowerCase().includes('binance'),
        timestamp: Date.now(),
      }))
  } catch {
    return []
  }
}

function getDirection(transfers: WhaleTransfer[]): 'bullish' | 'bearish' | 'neutral' {
  const toExchange = transfers.filter(t => t.toExchange).reduce((sum, t) => sum + t.amountUsd, 0)
  const fromExchange = transfers.filter(t => t.fromExchange).reduce((sum, t) => sum + t.amountUsd, 0)

  // Net flow to exchange = potential sell pressure = bearish
  if (toExchange > fromExchange * 1.5) return 'bearish'
  // Net flow from exchange = accumulation = bullish
  if (fromExchange > toExchange * 1.5) return 'bullish'
  return 'neutral'
}

function normalizeWhaleVolume(totalUsd: number): number {
  // $0-500M maps to 0-100
  return Math.min(100, (totalUsd / 500_000_000) * 100)
}

function getHumanReadable(transfers: WhaleTransfer[]): string {
  const total = transfers.reduce((sum, t) => sum + t.amountUsd, 0)
  const toEx = transfers.filter(t => t.toExchange).reduce((sum, t) => sum + t.amountUsd, 0)
  const fromEx = transfers.filter(t => t.fromExchange).reduce((sum, t) => sum + t.amountUsd, 0)
  const totalM = (total / 1_000_000).toFixed(0)

  if (toEx > fromEx * 1.5) return `$${totalM}M whale transfers TO exchanges — potential sell pressure`
  if (fromEx > toEx * 1.5) return `$${totalM}M whale transfers FROM exchanges — accumulation`
  return `$${totalM}M whale transfers — balanced flow`
}

class WhaleTransfersProvider implements MarketDataProvider {
  readonly id = 'whale-transfers'
  readonly tier = 'onchain' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: transfers } = await getCached('whale:transfers', config.ttlMs, fetchWhaleTransfers)
    if (transfers.length === 0) return null

    const totalUsd = transfers.reduce((sum, t) => sum + t.amountUsd, 0)
    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: 'BTC', // Market-wide indicator
      market,
      rawValue: totalUsd,
      normalizedScore: normalizeWhaleVolume(totalUsd),
      direction: getDirection(transfers),
      confidence: totalUsd > 50_000_000 ? 0.7 : 0.4,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(transfers),
    }
  }
}

export const whaleTransfersProvider = new WhaleTransfersProvider()
