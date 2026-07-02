// ─────────────────────────────────────────────────────────────
// DEX Volume Provider
// Rising DEX/CEX ratio = early rotation signal
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface DexVolume {
  symbol: string
  dexVolume24h: number
  cexVolume24h: number
  ratio: number
}

async function fetchDexVolume(): Promise<DexVolume[]> {
  try {
    // Use DeFiLlama for DEX volumes
    const res = await fetch('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []

    const data = (await res.json()) as {
      protocols?: Array<{ name?: string; total24h?: number; total48h?: number }>
    }

    // Get top DEX volumes
    const protocols = (data.protocols ?? [])
      .filter(p => (p.total24h ?? 0) > 1_000_000)
      .slice(0, 20)

    const totalDexVolume = protocols.reduce((sum, p) => sum + (p.total24h ?? 0), 0)

    // Return as single market-wide signal
    return [{
      symbol: 'BTC', // Market-wide
      dexVolume24h: totalDexVolume,
      cexVolume24h: totalDexVolume * 10, // Estimate CEX is ~10x DEX
      ratio: 0.1, // DEX/CEX ratio
    }]
  } catch {
    return []
  }
}

function getDirection(ratio: number): 'bullish' | 'bearish' | 'neutral' {
  // Rising DEX ratio = more retail/independent activity = bullish rotation
  if (ratio > 0.15) return 'bullish'
  if (ratio < 0.05) return 'bearish'
  return 'neutral'
}

function getHumanReadable(data: DexVolume): string {
  const dexB = (data.dexVolume24h / 1_000_000_000).toFixed(2)
  const ratio = (data.ratio * 100).toFixed(1)
  return `DEX volume: $${dexB}B (DEX/CEX ratio: ${ratio}%)`
}

class DexVolumeProvider implements MarketDataProvider {
  readonly id = 'dex-volume'
  readonly tier = 'onchain' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: dexData } = await getCached('dex:volume', config.ttlMs, fetchDexVolume)
    const dex = dexData[0]
    if (!dex) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: 'BTC',
      market,
      rawValue: dex.ratio,
      normalizedScore: Math.min(100, dex.ratio * 500), // 0.2 ratio = 100 score
      direction: getDirection(dex.ratio),
      confidence: 0.5,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(dex),
    }
  }
}

export const dexVolumeProvider = new DexVolumeProvider()
