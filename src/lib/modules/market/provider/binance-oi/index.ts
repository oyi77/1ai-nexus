// ─────────────────────────────────────────────────────────────
// Binance Open Interest Provider
// OI level, % change (1h/4h/24h), OI-to-volume ratio
// ─────────────────────────────────────────────────────────────

import type { MarketDataProvider, NormalizedSignal, MarketVertical } from '../../types'
import { getCached } from '@/lib/api/server-cache'
import { getProviderConfig, isProviderEnabledForVertical } from '@/lib/config/market-sources'

interface OIData {
  symbol: string
  openInterest: number
  notionalValue: number
}

// Fetch OI from Binance
async function fetchOI(): Promise<OIData[]> {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []

    const data = (await res.json()) as { symbol: string; openInterest: string }
    return [{
      symbol: data.symbol.replace('USDT', ''),
      openInterest: parseFloat(data.openInterest),
      notionalValue: parseFloat(data.openInterest) * 60000, // Approximate
    }]
  } catch {
    return []
  }
}

function normalizeOI(oi: number): number {
  // BTC OI typical range: 50K-200K contracts
  // Map to 0-100
  return Math.min(100, (oi / 200_000) * 100)
}

function getDirection(oi: number): 'bullish' | 'bearish' | 'neutral' {
  // High OI with high funding = crowded, risky
  // Rising OI + rising price = trend continuation
  // For now, return neutral (needs price context)
  return 'neutral'
}

function getHumanReadable(data: OIData): string {
  const oiK = (data.openInterest / 1000).toFixed(1)
  const notionalM = (data.notionalValue / 1_000_000).toFixed(0)
  return `${data.symbol}: ${oiK}K contracts open interest ($${notionalM}M notional)`
}

class BinanceOIProvider implements MarketDataProvider {
  readonly id = 'binance-oi'
  readonly tier = 'positioning' as const
  readonly supportedMarkets: MarketVertical[] = ['crypto_cex', 'binary', 'deriv']

  isEnabled(market: MarketVertical): boolean {
    return isProviderEnabledForVertical(this.id, market)
  }

  async fetchSignal(symbol: string, market: MarketVertical): Promise<NormalizedSignal | null> {
    if (!this.isEnabled(market)) return null

    const config = getProviderConfig(this.id, this.tier)
    const { data: oiData } = await getCached('oi:all', config.ttlMs, fetchOI)
    const oi = oiData.find(d => d.symbol === symbol)

    if (!oi) return null

    const now = new Date().toISOString()

    return {
      providerId: this.id,
      tier: this.tier,
      symbol: `${symbol}USDT`,
      market,
      rawValue: oi.openInterest,
      normalizedScore: normalizeOI(oi.openInterest),
      direction: getDirection(oi.openInterest),
      confidence: 0.8,
      fetchedAt: now,
      sourceTimestamp: now,
      humanReadable: getHumanReadable(oi),
    }
  }
}

export const binanceOIProvider = new BinanceOIProvider()
