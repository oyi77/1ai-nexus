// ─────────────────────────────────────────────────────────────
// Kimchi Premium Tracker — BTC/ETH KRW vs global price
// Tier 0: Upbit (KRW-BTC, KRW-ETH) + Binance + ECB FX
// §4.1 — arbitrage signal, z-score on 30-day rolling window
// ─────────────────────────────────────────────────────────────

import { getKrwUsdRate } from '@/lib/dal/fx/ecb'

interface UpbitTicker {
  market: string
  trade_price: number // KRW
  signed_change_rate: number
  acc_trade_volume_24h: number
}

interface BinancePrice {
  symbol: string
  price: string
}

export interface KimchiPremium {
  asset: string
  krwPrice: number
  krwPriceUsd: number
  globalPriceUsd: number
  premiumPct: number // (krwUsd - global) / global * 100
  zScore: number
  alert: boolean // |z| > 2
  krwUsdRate: number
  timestamp: number
}

export interface KimchiHistoryPoint {
  premiumPct: number
  timestamp: number
}

// 30-day rolling window — runtime only, per instance
const PREMIUM_HISTORY: Map<string, KimchiHistoryPoint[]> = new Map()
const MAX_HISTORY_DAYS = 30
const MAX_POINTS_PER_ASSET = MAX_HISTORY_DAYS * 24 * 4 // ~15-min interval
const ALERT_THRESHOLD_ZSCORE = 2

function pushHistory(asset: string, premiumPct: number, timestamp: number) {
  if (!PREMIUM_HISTORY.has(asset)) PREMIUM_HISTORY.set(asset, [])
  const arr = PREMIUM_HISTORY.get(asset)!
  arr.push({ premiumPct, timestamp })
  const cutoff = timestamp - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000
  while (arr.length > 0 && arr[0].timestamp < cutoff) arr.shift()
  if (arr.length > MAX_POINTS_PER_ASSET) arr.splice(0, arr.length - MAX_POINTS_PER_ASSET)
}

function calcZScore(history: KimchiHistoryPoint[], current: number): number {
  if (history.length < 2) return 0
  const values = history.map(p => p.premiumPct)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const stdDev = Math.sqrt(variance)
  if (stdDev < 0.0001) return 0
  return (current - mean) / stdDev
}

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/**
 * Fetch current Kimchi premium for BTC and ETH.
 */
export async function getKimchiPremium(): Promise<KimchiPremium[]> {
  const [upbitData, binanceBtc, binanceEth, krwUsdRateRaw] = await Promise.all([
    fetchJson<UpbitTicker[]>('https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH'),
    fetchJson<BinancePrice>('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
    fetchJson<BinancePrice>('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT'),
    getKrwUsdRate().catch(() => 0),
  ])

  // Fallback: approximate KRW/USD from Upbit BTC price vs Binance BTC price
  const upbitBtc = upbitData.find(t => t.market === 'KRW-BTC')
  const binanceBtcPrice = Number(binanceBtc.price)
  // KRW/USD rate: from FX API, or computed from Upbit/Binance BTC prices
  const krwUsdRate = krwUsdRateRaw > 0
    ? krwUsdRateRaw
    : (upbitBtc && binanceBtcPrice > 0 ? upbitBtc.trade_price / binanceBtcPrice : 0)

  if (krwUsdRate <= 0) {
    throw new Error('Unable to determine KRW/USD rate — FX API and price-derived rate both unavailable')
  }

  const binanceMap: Record<string, number> = {
    'KRW-BTC': Number(binanceBtc.price),
    'KRW-ETH': Number(binanceEth.price),
  }

  const now = Date.now()
  const results: KimchiPremium[] = []

  for (const ticker of upbitData) {
    const asset = ticker.market === 'KRW-BTC' ? 'BTC' : 'ETH'
    const krwPrice = ticker.trade_price
    const globalPriceUsd = binanceMap[ticker.market]
    const krwPriceUsd = krwPrice / krwUsdRate
    const premiumPct = globalPriceUsd > 0
      ? ((krwPriceUsd - globalPriceUsd) / globalPriceUsd) * 100
      : 0

    pushHistory(asset, premiumPct, now)
    const history = PREMIUM_HISTORY.get(asset) || []
    const zScore = calcZScore(history, premiumPct)

    results.push({
      asset,
      krwPrice,
      krwPriceUsd,
      globalPriceUsd,
      premiumPct,
      zScore,
      alert: Math.abs(zScore) > ALERT_THRESHOLD_ZSCORE,
      krwUsdRate,
      timestamp: now,
    })
  }

  return results
}

/**
 * Get historical premium data for a specific asset.
 */
export async function getKimchiHistory(asset = 'BTC'): Promise<KimchiHistoryPoint[]> {
  return PREMIUM_HISTORY.get(asset) || []
}

/**
 * Get the current z-score for Kimchi premium of a specific asset.
 */
export async function getKimchiZScore(asset = 'BTC'): Promise<number> {
  const history = PREMIUM_HISTORY.get(asset) || []
  if (history.length < 2) return 0
  const latest = history[history.length - 1].premiumPct
  return calcZScore(history.slice(0, -1), latest)
}
