// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Cross-correlates multiple data sources
// Trade flow + Whale alerts + Funding rates + Sentiment → Score
// Includes: Entry, TP1, TP2, TP3, SL, Valid Period
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { getFlowData } from '@/lib/modules/market/trade-aggregator'

export type ValidPeriod = '4h' | '24h' | '7d'

export interface AlphaSignal {
  id: string
  symbol: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  sources: string[]
  reasoning: string
  timestamp: number
  // Trading levels
  entry: number | null
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  validPeriod: ValidPeriod
  expiresAt: number
}

interface PriceData {
  symbol: string
  price: number
  high24h: number
  low24h: number
}

// Fetch current prices from Binance for crypto symbols
async function fetchCurrentPrices(symbols: string[]): Promise<Record<string, PriceData>> {
  const priceMap: Record<string, PriceData> = {}
  if (symbols.length === 0) return priceMap

  // Filter to likely Binance symbols (uppercase, no special chars)
  const binanceSymbols = symbols.filter(s => /^[A-Z0-9]+$/.test(s))
  if (binanceSymbols.length === 0) return priceMap

  // Fetch prices in parallel (batch of 10 to avoid rate limits)
  const batchSize = 10
  for (let i = 0; i < binanceSymbols.length; i += batchSize) {
    const batch = binanceSymbols.slice(i, i + batchSize)
    const promises = batch.map(async (symbol) => {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`,
          { signal: AbortSignal.timeout(5_000) }
        )
        if (!res.ok) return

        const data = (await res.json()) as {
          symbol: string
          lastPrice: string
          highPrice: string
          lowPrice: string
        }

        priceMap[symbol] = {
          symbol,
          price: parseFloat(data.lastPrice),
          high24h: parseFloat(data.highPrice),
          low24h: parseFloat(data.lowPrice),
        }
      } catch { /* symbol not on Binance */ }
    })

    await Promise.all(promises)
  }

  return priceMap
}

// Calculate trading levels based on ATR-like volatility
function calculateLevels(
  price: number,
  high24h: number,
  low24h: number,
  direction: 'bullish' | 'bearish' | 'neutral'
): { entry: number; tp1: number; tp2: number; tp3: number; sl: number } | null {
  if (!price || price <= 0) return null

  // ATR approximation using 24h range
  const atr = high24h - low24h
  if (atr <= 0) return null

  const entry = price

  if (direction === 'bullish') {
    return {
      entry,
      tp1: entry + atr * 0.5,   // Conservative target
      tp2: entry + atr * 1.0,   // Moderate target
      tp3: entry + atr * 1.5,   // Aggressive target
      sl: entry - atr * 0.75,   // Stop loss below entry
    }
  } else if (direction === 'bearish') {
    return {
      entry,
      tp1: entry - atr * 0.5,   // Conservative target
      tp2: entry - atr * 1.0,   // Moderate target
      tp3: entry - atr * 1.5,   // Aggressive target
      sl: entry + atr * 0.75,   // Stop loss above entry
    }
  }

  return null
}

// Determine valid period based on signal source and strength
function determineValidPeriod(source: string, strength: number): ValidPeriod {
  // High-strength signals get longer validity
  if (strength >= 80) return '7d'
  // Funding rate and whale signals are medium-term
  if (source === 'funding-rate' || source === 'whale-alert') return '24h'
  // Trade flow and sentiment are shorter-term
  return '4h'
}

async function fetchAlphaSignals(): Promise<AlphaSignal[]> {
  const signals: Array<Omit<AlphaSignal, 'entry' | 'tp1' | 'tp2' | 'tp3' | 'sl' | 'validPeriod' | 'expiresAt'>> = []
  const symbols = new Set<string>()
  const now = Date.now()

  // Source 1: Trade Flow
  const flow = getFlowData()
  for (const f of flow.flows) {
    const totalVol = f.buyVolume + f.sellVolume
    if (totalVol < 10000) continue

    const buyRatio = f.buyVolume / totalVol
    const netFlowM = f.netFlow / 1e6

    if (buyRatio > 0.6) {
      symbols.add(f.symbol)
      signals.push({
        id: `flow-buy-${f.symbol}-${now}`,
        symbol: f.symbol,
        direction: 'bullish',
        strength: Math.min(90, Math.round(buyRatio * 100)),
        confidence: Math.min(80, Math.round(totalVol / 100000)),
        sources: ['trade-flow'],
        reasoning: `Strong buy pressure: ${(buyRatio * 100).toFixed(0)}% buy volume ($${netFlowM.toFixed(1)}M net inflow) across ${f.tradeCount} trades`,
        timestamp: now,
      })
    } else if (buyRatio < 0.4) {
      symbols.add(f.symbol)
      signals.push({
        id: `flow-sell-${f.symbol}-${now}`,
        symbol: f.symbol,
        direction: 'bearish',
        strength: Math.min(90, Math.round((1 - buyRatio) * 100)),
        confidence: Math.min(80, Math.round(totalVol / 100000)),
        sources: ['trade-flow'],
        reasoning: `Strong sell pressure: ${((1 - buyRatio) * 100).toFixed(0)}% sell volume ($${Math.abs(netFlowM).toFixed(1)}M net outflow) across ${f.tradeCount} trades`,
        timestamp: now,
      })
    }
  }

  // Source 2: Funding Rates (Binance)
  try {
    const fundingRes = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
      signal: AbortSignal.timeout(10_000),
    })
    if (fundingRes.ok) {
      const funding = (await fundingRes.json()) as Array<{ symbol: string; lastFundingRate: string }>
      for (const f of funding) {
        const rate = parseFloat(f.lastFundingRate)
        const symbol = f.symbol.replace('USDT', '')

        if (rate > 0.0005) {
          symbols.add(symbol)
          signals.push({
            id: `funding-bear-${symbol}-${now}`,
            symbol,
            direction: 'bearish',
            strength: Math.min(80, Math.round(rate * 100000)),
            confidence: 60,
            sources: ['funding-rate'],
            reasoning: `Extreme positive funding ${(rate * 100).toFixed(4)}% — crowded longs, potential squeeze down`,
            timestamp: now,
          })
        } else if (rate < -0.0005) {
          symbols.add(symbol)
          signals.push({
            id: `funding-bull-${symbol}-${now}`,
            symbol,
            direction: 'bullish',
            strength: Math.min(80, Math.round(Math.abs(rate) * 100000)),
            confidence: 60,
            sources: ['funding-rate'],
            reasoning: `Negative funding ${(rate * 100).toFixed(4)}% — shorts paying longs, potential squeeze up`,
            timestamp: now,
          })
        }
      }
    }
  } catch { /* silent */ }

  // Source 3: Fear & Greed (contrarian)
  try {
    const fgRes = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(10_000),
    })
    if (fgRes.ok) {
      const fg = (await fgRes.json()) as { data?: Array<{ value: string; value_classification: string }> }
      const score = parseInt(fg.data?.[0]?.value ?? '50')

      if (score < 20) {
        symbols.add('BTC')
        signals.push({
          id: `fg-extreme-fear-${now}`,
          symbol: 'BTC',
          direction: 'bullish',
          strength: 70,
          confidence: 65,
          sources: ['fear-greed'],
          reasoning: `Extreme Fear (${score}/100) — historically a contrarian buy signal. Market oversold.`,
          timestamp: now,
        })
      } else if (score > 80) {
        symbols.add('BTC')
        signals.push({
          id: `fg-extreme-greed-${now}`,
          symbol: 'BTC',
          direction: 'bearish',
          strength: 70,
          confidence: 65,
          sources: ['fear-greed'],
          reasoning: `Extreme Greed (${score}/100) — historically a contrarian sell signal. Market overbought.`,
          timestamp: now,
        })
      }
    }
  } catch { /* silent */ }

  // Source 4: Whale Alerts
  try {
    const whaleRes = await fetch('http://localhost:4400/api/v1/whale-alert', {
      signal: AbortSignal.timeout(10_000),
    })
    if (whaleRes.ok) {
      const whaleData = (await whaleRes.json()) as { data?: { items?: Array<{ symbol: string; usd: number; from: string; to: string }> } }
      const alerts = whaleData.data?.items ?? []

      for (const a of alerts) {
        if (a.usd < 10_000_000) continue

        const toExchange = a.to.toLowerCase().includes('binance') || a.to.toLowerCase().includes('coinbase') || a.to.toLowerCase().includes('kraken')
        const fromExchange = a.from.toLowerCase().includes('binance') || a.from.toLowerCase().includes('coinbase') || a.from.toLowerCase().includes('kraken')

        if (toExchange) {
          symbols.add(a.symbol)
          signals.push({
            id: `whale-exchange-in-${now}-${Math.random().toString(36).slice(2, 4)}`,
            symbol: a.symbol,
            direction: 'bearish',
            strength: Math.min(85, Math.round(a.usd / 1000000)),
            confidence: 55,
            sources: ['whale-alert'],
            reasoning: `$${(a.usd / 1e6).toFixed(0)}M ${a.symbol} moved TO ${a.to} — potential sell pressure incoming`,
            timestamp: now,
          })
        } else if (fromExchange) {
          symbols.add(a.symbol)
          signals.push({
            id: `whale-exchange-out-${now}-${Math.random().toString(36).slice(2, 4)}`,
            symbol: a.symbol,
            direction: 'bullish',
            strength: Math.min(85, Math.round(a.usd / 1000000)),
            confidence: 55,
            sources: ['whale-alert'],
            reasoning: `$${(a.usd / 1e6).toFixed(0)}M ${a.symbol} moved FROM ${a.from} — accumulation, reducing sell pressure`,
            timestamp: now,
          })
        }
      }
    }
  } catch { /* silent */ }

  // Fetch current prices for all symbols with signals
  const prices = await fetchCurrentPrices(Array.from(symbols))

  // Enrich signals with trading levels
  const enriched: AlphaSignal[] = signals.map(s => {
    const priceData = prices[s.symbol]
    const primarySource = s.sources[0] ?? 'trade-flow'
    const validPeriod = determineValidPeriod(primarySource, s.strength)

    // Calculate expiration time
    const periodMs: Record<ValidPeriod, number> = { '4h': 4 * 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 }
    const expiresAt = now + periodMs[validPeriod]

    // Calculate trading levels if price data available
    let levels = null
    if (priceData) {
      levels = calculateLevels(priceData.price, priceData.high24h, priceData.low24h, s.direction)
    }

    return {
      ...s,
      entry: levels?.entry ?? null,
      tp1: levels?.tp1 ?? null,
      tp2: levels?.tp2 ?? null,
      tp3: levels?.tp3 ?? null,
      sl: levels?.sl ?? null,
      validPeriod,
      expiresAt,
    }
  })

  // Sort by strength * confidence
  enriched.sort((a, b) => (b.strength * b.confidence) - (a.strength * a.confidence))

  return enriched.slice(0, 30)
}

export async function getAlphaSignals(): Promise<{ signals: AlphaSignal[]; sourceCount: number; timestamp: number }> {
  const { data, fromCache } = await getCached('alpha-signals', 30_000, fetchAlphaSignals)
  return {
    signals: data,
    sourceCount: new Set(data.flatMap(s => s.sources)).size,
    timestamp: Date.now(),
  }
}