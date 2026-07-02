// ─────────────────────────────────────────────────────────────
// Stablecoin Supply Provider
// Net supply change = incoming buy-side liquidity indicator
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface StablecoinData {
  symbol: string
  marketCap: number
  change24h: number
  changePercent: number
}

async function fetchStablecoins(): Promise<StablecoinData[]> {
  try {
    const res = await fetch('http://localhost:4400/api/v1/stablecoins', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []

    const data = (await res.json()) as {
      data?: Array<{ symbol?: string; marketCap?: number; change24h?: number }>
    }

    return (data.data ?? []).map(s => ({
      symbol: s.symbol ?? 'USDT',
      marketCap: (s as any).marketCap ?? 0,
      change24h: s.change24h ?? 0,
      changePercent: (s as any).marketCap > 0 ? ((s as any).change24h ?? 0) / (s as any).marketCap * 100 : 0,
    }))
  } catch {
    return []
  }
}

// Net minting = bullish (new capital entering)
// Net redemption = bearish (capital leaving)
function getDirection(totalChange: number): 'bullish' | 'bearish' | 'neutral' {
  if (totalChange > 50_000_000) return 'bullish'
  if (totalChange < -50_000_000) return 'bearish'
  return 'neutral'
}

function normalizeStablecoinFlow(change: number): number {
  // ±$500M maps to 0-100
  const clamped = Math.max(-500_000_000, Math.min(500_000_000, change))
  return ((clamped + 500_000_000) / 1_000_000_000) * 100
}

function getHumanReadable(stables: StablecoinData[]): string {
  const totalChange = stables.reduce((sum, s) => sum + s.change24h, 0)
  const totalM = Math.abs(totalChange / 1_000_000).toFixed(0)
  const direction = totalChange > 0 ? 'minted' : 'redeemed'
  return `Stablecoins: $${totalM}M net ${direction} in 24h`
}

class StablecoinSupplyProvider implements MarketDataProvider {
  readonly id = 'stablecoin-supply'
  readonly tier = 'onchain' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: stables } = await getCached('stablecoins:supply', config.ttlMs, fetchStablecoins)
    if (stables.length === 0) return null

    const totalChange = stables.reduce((sum, s) => sum + s.change24h, 0)
    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: 'USDT', // Market-wide indicator
      market,
      rawValue: totalChange,
      normalizedScore: normalizeStablecoinFlow(totalChange),
      direction: getDirection(totalChange),
      confidence: 0.65,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(stables),
    }
  }
}

export const stablecoinSupplyProvider = new StablecoinSupplyProvider()
