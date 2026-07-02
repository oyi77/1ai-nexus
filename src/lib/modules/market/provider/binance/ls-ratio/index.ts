// ─────────────────────────────────────────────────────────────
// Binance Long/Short Ratio Provider
// Global account ratio, normalized to sentiment extremes
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface LongShortData {
  symbol: string
  longShortRatio: number
  longAccount: number
  shortAccount: number
  timestamp: number
}

// Fetch latest L/S ratio snapshot from Binance
async function fetchLongShortRatio(symbol: string): Promise<LongShortData | null> {
  const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}USDT&period=1h&limit=1`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null

  const data = (await res.json()) as Array<{
    symbol: string
    longShortRatio: string
    longAccount: string
    shortAccount: string
    timestamp: number
  }>

  if (!data.length) return null

  const latest = data[data.length - 1]
  return {
    symbol: latest.symbol.replace('USDT', ''),
    longShortRatio: parseFloat(latest.longShortRatio),
    longAccount: parseFloat(latest.longAccount),
    shortAccount: parseFloat(latest.shortAccount),
    timestamp: latest.timestamp,
  }
}

// Normalize ratio to 0-100 score
// 0.5 (extreme short) → 0, 1.25 (neutral) → 50, 2.0 (extreme long) → 100
function normalizeRatio(ratio: number): number {
  const clamped = Math.max(0.5, Math.min(2.0, ratio))
  return ((clamped - 0.5) / 1.5) * 100
}

// Contrarian direction: crowded positioning signals reversal risk
function getDirection(ratio: number): 'bullish' | 'bearish' | 'neutral' {
  if (ratio > 1.5) return 'bearish'   // Crowded longs — contrarian bearish
  if (ratio < 0.7) return 'bullish'   // Crowded shorts — contrarian bullish
  return 'neutral'
}

function getHumanReadable(ratio: number, longPct: number, shortPct: number, symbol: string): string {
  const r = ratio.toFixed(2)
  const lp = (longPct * 100).toFixed(0)
  const sp = (shortPct * 100).toFixed(0)
  return `${symbol} L/S ratio ${r} — ${lp}% accounts long, ${sp}% short`
}

class BinanceLsRatioProvider implements MarketDataProvider {
  readonly id = 'binance-ls-ratio'
  readonly tier = 'positioning' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const cacheKey = `ls-ratio:${symbol}`

    const { data: ls } = await getCached(cacheKey, config.ttlMs, () => fetchLongShortRatio(symbol))
    if (!ls) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: `${symbol}USDT`,
      market,
      rawValue: ls.longShortRatio,
      normalizedScore: normalizeRatio(ls.longShortRatio),
      direction: getDirection(ls.longShortRatio),
      confidence: 0.85, // High confidence — direct from exchange
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(ls.longShortRatio, ls.longAccount, ls.shortAccount, symbol),
    }
  }
}

export const binanceLsRatioProvider = new BinanceLsRatioProvider()
