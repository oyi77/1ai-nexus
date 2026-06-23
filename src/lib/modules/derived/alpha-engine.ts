// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Cross-correlates multiple data sources
// Trade flow + Whale alerts + Funding rates + Sentiment → Score
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { getFlowData } from '@/lib/modules/market/trade-aggregator'

export interface AlphaSignal {
  id: string
  symbol: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  sources: string[]
  reasoning: string
  timestamp: number
}

async function fetchAlphaSignals(): Promise<AlphaSignal[]> {
  const signals: AlphaSignal[] = []
  const now = Date.now()

  // Source 1: Trade Flow
  const flow = getFlowData()
  for (const f of flow.flows) {
    const totalVol = f.buyVolume + f.sellVolume
    if (totalVol < 10000) continue // Skip low volume

    const buyRatio = f.buyVolume / totalVol
    const netFlowM = f.netFlow / 1e6

    if (buyRatio > 0.6) {
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

  // Source 4: Whale Alerts (cross-reference with flow)
  try {
    const whaleRes = await fetch('http://localhost:4400/api/v1/whale-alert', {
      signal: AbortSignal.timeout(10_000),
    })
    if (whaleRes.ok) {
      const whaleData = (await whaleRes.json()) as { data?: { items?: Array<{ symbol: string; usd: number; from: string; to: string }> } }
      const alerts = whaleData.data?.items ?? []

      for (const a of alerts) {
        if (a.usd < 10_000_000) continue // Only $10M+ moves

        const toExchange = a.to.toLowerCase().includes('binance') || a.to.toLowerCase().includes('coinbase') || a.to.toLowerCase().includes('kraken')
        const fromExchange = a.from.toLowerCase().includes('binance') || a.from.toLowerCase().includes('coinbase') || a.from.toLowerCase().includes('kraken')

        if (toExchange) {
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

  // Sort by strength * confidence
  signals.sort((a, b) => (b.strength * b.confidence) - (a.strength * a.confidence))

  return signals.slice(0, 30)
}

export async function getAlphaSignals(): Promise<{ signals: AlphaSignal[]; sourceCount: number; timestamp: number }> {
  const { data, fromCache } = await getCached('alpha-signals', 30_000, fetchAlphaSignals)
  return {
    signals: data,
    sourceCount: new Set(data.flatMap(s => s.sources)).size,
    timestamp: Date.now(),
  }
}