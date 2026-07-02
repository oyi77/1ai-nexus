// ─────────────────────────────────────────────────────────────
// Binance Liquidations Provider
// Rolling liquidation volume by side, cascade detection
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface LiquidationData {
  symbol: string
  totalUsd: number
  longLiquidations: number
  shortLiquidations: number
}

// Fetch liquidation data from internal API or Binance
async function fetchLiquidations(): Promise<LiquidationData[]> {
  try {
    // Try internal API first
    const res = await fetch('http://localhost:4400/api/v1/liquidations', {
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as {
        data?: { heatmap?: Array<{ symbol?: string; longLiquidations?: number; shortLiquidations?: number }> }
      }
      const heatmap = data.data?.heatmap ?? []
      const bySymbol = new Map<string, { longs: number; shorts: number }>()

      for (const h of heatmap) {
        const sym = (h.symbol ?? 'BTC').replace('USDT', '')
        const existing = bySymbol.get(sym) ?? { longs: 0, shorts: 0 }
        existing.longs += h.longLiquidations ?? 0
        existing.shorts += h.shortLiquidations ?? 0
        bySymbol.set(sym, existing)
      }

      return Array.from(bySymbol.entries()).map(([symbol, v]) => ({
        symbol,
        totalUsd: v.longs + v.shorts,
        longLiquidations: v.longs,
        shortLiquidations: v.shorts,
      }))
    }
  } catch { /* fallback */ }

  // Fallback: empty
  return []
}

function normalizeLiquidationVolume(totalUsd: number): number {
  // $0-100M maps to 0-100
  return Math.min(100, (totalUsd / 1_000_000) * 100)
}

function getDirection(data: LiquidationData): 'bullish' | 'bearish' | 'neutral' {
  if (data.totalUsd < 1_000_000) return 'neutral'
  const longRatio = data.longLiquidations / data.totalUsd
  // Long liquidations = price dropped = potential bounce (contrarian bullish)
  if (longRatio > 0.7) return 'bullish'
  // Short liquidations = price pumped = potential pullback (contrarian bearish)
  if (longRatio < 0.3) return 'bearish'
  return 'neutral'
}

function getHumanReadable(data: LiquidationData): string {
  const totalM = (data.totalUsd / 1_000_000).toFixed(1)
  const longPct = data.totalUsd > 0 ? Math.round((data.longLiquidations / data.totalUsd) * 100) : 50
  if (data.totalUsd < 1_000_000) return `${data.symbol}: $${totalM}M liquidations — low activity`
  return `${data.symbol}: $${totalM}M liquidations (${longPct}% longs) — ${longPct > 60 ? 'capitulation event' : longPct < 40 ? 'short squeeze' : 'balanced'}`
}

class BinanceLiquidationsProvider implements MarketDataProvider {
  readonly id = 'binance-liquidations'
  readonly tier = 'positioning' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: liquidations } = await getCached('liquidations:all', config.ttlMs, fetchLiquidations)
    const liq = liquidations.find(l => l.symbol === symbol)

    if (!liq || liq.totalUsd < 100_000) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: `${symbol}USDT`,
      market,
      rawValue: liq.totalUsd,
      normalizedScore: normalizeLiquidationVolume(liq.totalUsd),
      direction: getDirection(liq),
      confidence: liq.totalUsd > 10_000_000 ? 0.8 : 0.5,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(liq),
    }
  }
}

export const binanceLiquidationsProvider = new BinanceLiquidationsProvider()
