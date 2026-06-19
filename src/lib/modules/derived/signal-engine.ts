// ─────────────────────────────────────────────────────────────
// Cross-Signal Engine — Correlates data across modules
// Detects combined signals that individual modules can't see
// ─────────────────────────────────────────────────────────────

import { getLatestPrice, getAllLatest } from './price-store'

export interface Signal {
  id: string
  type: 'bullish' | 'bearish' | 'neutral' | 'warning'
  title: string
  description: string
  sources: string[]
  confidence: number  // 0-1
  timestamp: number
  tags: string[]
}

const signalLog: Signal[] = []
const MAX_SIGNALS = 500

/** Run all signal detectors and return new signals */
export function detectSignals(context: {
  fearGreed?: number
  fearGreedClassification?: string
  newsSentiment?: { score: number; label: string }
  fundingRate?: number
  btcDominance?: number
}): Signal[] {
  const signals: Signal[] = []
  const now = Date.now()

  // 1. Extreme Fear + Price Drop = Contrarian Buy Signal
  if (context.fearGreed != null && context.fearGreed < 20) {
    const btc = getLatestPrice('BTC')
    if (btc && btc.change24h < -5) {
      signals.push({
        id: `extreme-fear-buy-${now}`,
        type: 'bullish',
        title: 'Contrarian Buy Signal: Extreme Fear + Price Drop',
        description: `Fear & Greed at ${context.fearGreed} (${context.fearGreedClassification}) with BTC down ${btc.change24h.toFixed(1)}% in 24h. Historical contrarian opportunity.`,
        sources: ['fear-greed', 'coingecko'],
        confidence: 0.75,
        timestamp: now,
        tags: ['contrarian', 'fear', 'buy-signal'],
      })
    }
  }

  // 2. Extreme Greed + High Volume = Caution Signal
  if (context.fearGreed != null && context.fearGreed > 80) {
    const btc = getLatestPrice('BTC')
    if (btc && btc.change24h > 10) {
      signals.push({
        id: `extreme-greed-caution-${now}`,
        type: 'warning',
        title: 'Caution: Extreme Greed + Parabolic Move',
        description: `Fear & Greed at ${context.fearGreed} with BTC up ${btc.change24h.toFixed(1)}% in 24h. Consider taking profits.`,
        sources: ['fear-greed', 'coingecko'],
        confidence: 0.7,
        timestamp: now,
        tags: ['caution', 'greed', 'take-profit'],
      })
    }
  }

  // 3. Negative Funding + Price Drop = Liquidation Cascade Risk
  if (context.fundingRate != null && context.fundingRate < -0.01) {
    const btc = getLatestPrice('BTC')
    if (btc && btc.change24h < -3) {
      signals.push({
        id: `liquidation-risk-${now}`,
        type: 'bearish',
        title: 'Liquidation Cascade Risk: Negative Funding + Price Drop',
        description: `Funding rate at ${(context.fundingRate * 100).toFixed(3)}% with BTC down ${btc.change24h.toFixed(1)}%. Short squeeze or further liquidations possible.`,
        sources: ['binance', 'coingecko'],
        confidence: 0.65,
        timestamp: now,
        tags: ['liquidation', 'funding', 'risk'],
      })
    }
  }

  // 4. BTC Dominance Shift = Alt Season Signal
  if (context.btcDominance != null) {
    const eth = getLatestPrice('ETH')
    const sol = getLatestPrice('SOL')
    if (eth && sol && context.btcDominance < 45 && eth.change24h > 5 && sol.change24h > 5) {
      signals.push({
        id: `alt-season-${now}`,
        type: 'bullish',
        title: 'Alt Season Signal: BTC Dominance Drop + Alts Rallying',
        description: `BTC dominance at ${context.btcDominance.toFixed(1)}% with ETH +${eth.change24h.toFixed(1)}% and SOL +${sol.change24h.toFixed(1)}%. Capital rotating to alts.`,
        sources: ['coingecko'],
        confidence: 0.6,
        timestamp: now,
        tags: ['alt-season', 'dominance', 'rotation'],
      })
    }
  }

  // 5. Multi-Asset Correlated Dump
  const allPrices = getAllLatest()
  const assets = Array.from(allPrices.values())
  const allDown = assets.filter(a => a.change24h < -5).length
  if (allDown >= 5) {
    signals.push({
      id: `correlated-dump-${now}`,
      type: 'bearish',
      title: `Correlated Dump: ${allDown} assets down >5%`,
      description: `${allDown} tracked assets dropped more than 5% in 24h. Broad market selloff in progress.`,
      sources: ['coingecko'],
      confidence: 0.8,
      timestamp: now,
      tags: ['correlated', 'selloff', 'macro'],
    })
  }

  // 6. Bullish News Sentiment + Price Recovery
  if (context.newsSentiment && context.newsSentiment.score > 0.3) {
    const btc = getLatestPrice('BTC')
    if (btc && btc.change24h > 3) {
      signals.push({
        id: `bullish-sentiment-recovery-${now}`,
        type: 'bullish',
        title: 'Bullish Confluence: Positive News + Price Recovery',
        description: `News sentiment at ${context.newsSentiment.label} (${(context.newsSentiment.score * 100).toFixed(0)}%) with BTC up ${btc.change24h.toFixed(1)}%.`,
        sources: ['rss-engine', 'coingecko'],
        confidence: 0.65,
        timestamp: now,
        tags: ['sentiment', 'recovery', 'confluence'],
      })
    }
  }

  // Store and return
  for (const s of signals) {
    signalLog.push(s)
    if (signalLog.length > MAX_SIGNALS) signalLog.shift()
  }

  return signals
}

export function getRecentSignals(limit = 20): Signal[] {
  return signalLog.slice(-limit).reverse()
}

export function getSignalCount(): number {
  return signalLog.length
}
