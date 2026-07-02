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

  // ── Source 1: Trade Flow (aggr.trade style) ──────────────────
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

  // ── Source 2: Funding Rates (Binance Futures) ─────────────────
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

  // ── Source 3: Open Interest Changes ───────────────────────────
  try {
    const oiRes = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', {
      signal: AbortSignal.timeout(10_000),
    })
    if (oiRes.ok) {
      const oi = (await oiRes.json()) as { openInterest: string }
      const oiValue = parseFloat(oi.openInterest)
      // High OI + high funding = crowded trade
      if (oiValue > 100000) { // >100K BTC
        symbols.add('BTC')
        signals.push({
          id: `oi-high-${now}`,
          symbol: 'BTC',
          direction: 'neutral',
          strength: 50,
          confidence: 45,
          sources: ['open-interest'],
          reasoning: `High open interest: ${oiValue.toFixed(0)} BTC — increased volatility likely`,
          timestamp: now,
        })
      }
    }
  } catch { /* silent */ }

  // ── Source 4: Fear & Greed (contrarian) ──────────────────────
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

  // ── Source 5: Whale Alerts ────────────────────────────────────
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

  // ── Source 6: Liquidation Data ────────────────────────────────
  try {
    const liqRes = await fetch('http://localhost:4400/api/v1/liquidations', {
      signal: AbortSignal.timeout(10_000),
    })
    if (liqRes.ok) {
      const liqData = (await liqRes.json()) as { data?: { total?: number; longs?: number; shorts?: number } }
      const total = liqData.data?.total ?? 0
      const longs = liqData.data?.longs ?? 0
      const shorts = liqData.data?.shorts ?? 0

      if (total > 100_000_000) { // >$100M liquidations
        const longRatio = longs / total
        symbols.add('BTC')
        signals.push({
          id: `liq-cascade-${now}`,
          symbol: 'BTC',
          direction: longRatio > 0.7 ? 'bullish' : 'bearish', // Contrarian
          strength: Math.min(75, Math.round(total / 10_000_000)),
          confidence: 50,
          sources: ['liquidations'],
          reasoning: `$${(total / 1e6).toFixed(0)}M liquidations — ${longRatio > 0.7 ? 'longs liquidated, potential bounce' : 'shorts squeezed, momentum up'}`,
          timestamp: now,
        })
      }
    }
  } catch { /* silent */ }

  // ── Source 7: Exchange Flows ──────────────────────────────────
  try {
    const flowRes = await fetch('http://localhost:4400/api/v1/exchange-flow', {
      signal: AbortSignal.timeout(10_000),
    })
    if (flowRes.ok) {
      const flowData = (await flowRes.json()) as { data?: { inflow?: number; outflow?: number; net?: number } }
      const net = flowData.data?.net ?? 0

      if (Math.abs(net) > 10_000_000) { // >$10M net flow
        symbols.add('BTC')
        signals.push({
          id: `exflow-${net > 0 ? 'in' : 'out'}-${now}`,
          symbol: 'BTC',
          direction: net > 0 ? 'bearish' : 'bullish', // Inflow to exchange = sell pressure
          strength: Math.min(70, Math.round(Math.abs(net) / 5_000_000)),
          confidence: 50,
          sources: ['exchange-flow'],
          reasoning: `$${(Math.abs(net) / 1e6).toFixed(0)}M net ${net > 0 ? 'inflow to' : 'outflow from'} exchanges — ${net > 0 ? 'potential sell pressure' : 'accumulation signal'}`,
          timestamp: now,
        })
      }
    }
  } catch { /* silent */ }

  // ── Source 8: Gas Tracker (Ethereum) ──────────────────────────
  try {
    const gasRes = await fetch('http://localhost:4400/api/v1/gas', {
      signal: AbortSignal.timeout(10_000),
    })
    if (gasRes.ok) {
      const gasData = (await gasRes.json()) as { data?: { standard?: number; fast?: number } }
      const gas = gasData.data?.standard ?? 0

      if (gas > 100) { // High gas = network congestion
        symbols.add('ETH')
        signals.push({
          id: `gas-high-${now}`,
          symbol: 'ETH',
          direction: 'neutral',
          strength: 40,
          confidence: 35,
          sources: ['gas-tracker'],
          reasoning: `High gas: ${gas} gwei — network congested, DeFi activity elevated`,
          timestamp: now,
        })
      }
    }
  } catch { /* silent */ }

  // ── Source 9: Stablecoin Flows ────────────────────────────────
  try {
    const stableRes = await fetch('http://localhost:4400/api/v1/stablecoin-flow', {
      signal: AbortSignal.timeout(10_000),
    })
    if (stableRes.ok) {
      const stableData = (await stableRes.json()) as { data?: { minted?: number; redeemed?: number } }
      const minted = stableData.data?.minted ?? 0
      const redeemed = stableData.data?.redeemed ?? 0
      const net = minted - redeemed

      if (Math.abs(net) > 50_000_000) { // >$50M net mint/redeem
        symbols.add('BTC')
        signals.push({
          id: `stable-${net > 0 ? 'mint' : 'redeem'}-${now}`,
          symbol: 'BTC',
          direction: net > 0 ? 'bullish' : 'bearish', // Minting = buying power
          strength: Math.min(65, Math.round(Math.abs(net) / 25_000_000)),
          confidence: 45,
          sources: ['stablecoin-flow'],
          reasoning: `$${(Math.abs(net) / 1e6).toFixed(0)}M net ${net > 0 ? 'USDT minted' : 'stablecoins redeemed'} — ${net > 0 ? 'new capital entering' : 'capital leaving'}`,
          timestamp: now,
        })
      }
    }
  } catch { /* silent */ }

  // ── Source 10: Derivatives Intel ──────────────────────────────
  try {
    const derivRes = await fetch('http://localhost:4400/api/v1/derivatives-intel', {
      signal: AbortSignal.timeout(10_000),
    })
    if (derivRes.ok) {
      const derivData = (await derivRes.json()) as { data?: { maxPain?: number; currentPrice?: number } }
      const maxPain = derivData.data?.maxPain ?? 0
      const currentPrice = derivData.data?.currentPrice ?? 0

      if (maxPain > 0 && currentPrice > 0) {
        const diff = ((currentPrice - maxPain) / maxPain) * 100
        if (Math.abs(diff) > 5) {
          symbols.add('BTC')
          signals.push({
            id: `deriv-maxpain-${now}`,
            symbol: 'BTC',
            direction: diff > 0 ? 'bearish' : 'bullish', // Price tends toward max pain
            strength: Math.min(60, Math.round(Math.abs(diff) * 3)),
            confidence: 40,
            sources: ['derivatives-intel'],
            reasoning: `BTC ${diff > 0 ? 'above' : 'below'} max pain ($${maxPain.toLocaleString()}) by ${Math.abs(diff).toFixed(1)}% — likely to gravitate toward max pain`,
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

  return enriched.slice(0, 50)
}

export async function getAlphaSignals(): Promise<{ signals: AlphaSignal[]; sourceCount: number; timestamp: number }> {
  const { data, fromCache } = await getCached('alpha-signals', 30_000, fetchAlphaSignals)
  return {
    signals: data,
    sourceCount: new Set(data.flatMap(s => s.sources)).size,
    timestamp: Date.now(),
  }
}