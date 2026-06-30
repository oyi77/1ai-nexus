// ─────────────────────────────────────────────────────────────
// Daily Edge Report — Combines all signals into actionable summary
// Published daily to Telegram + API
// ─────────────────────────────────────────────────────────────

import { registerAllModules } from '../index'

export interface EdgeSignal {
  asset: string
  direction: 'bullish' | 'bearish' | 'neutral'
  signalType: string
  confidence: number
  explanation: string
  riskReward: string
  timestamp: Date
}

export interface EdgeReport {
  date: string
  summary: string
  signals: EdgeSignal[]
  topPick: EdgeSignal | null
  marketRegime: string
  generatedAt: string
}

// Cache
let cachedReport: EdgeReport | null = null
let lastReportTime = 0
const REPORT_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function generateEdgeReport(): Promise<EdgeReport> {
  const now = Date.now()
  if (cachedReport && now - lastReportTime < REPORT_TTL_MS) {
    return cachedReport
  }

  const registry = registerAllModules()
  const signals: EdgeSignal[] = []

  try {
    // 1. Fear & Greed
    const fgRes = await registry.fetchOne<{ score?: number; label?: string }>('fear-greed', { limit: 1 }).catch(() => null)
    if (fgRes?.data) {
      const score = fgRes.data.score ?? 50
      signals.push({
        asset: 'Market',
        direction: score > 60 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
        signalType: 'Fear & Greed',
        confidence: Math.abs(score - 50) / 50,
        explanation: `Fear & Greed Index at ${score} (${fgRes.data.label || 'Unknown'}). ${score > 70 ? 'Extreme greed — consider taking profits.' : score < 30 ? 'Extreme fear — potential buying opportunity.' : 'Neutral sentiment.'}`,
        riskReward: score > 70 ? '1:2 (unfavorable)' : score < 30 ? '2:1 (favorable)' : '1:1 (neutral)',
        timestamp: new Date(),
      })
    }

    // 2. Whale activity
    try {
      const smartMoneyRes = await registry.fetchOne('nexus-internal', { action: 'smart-money' }).catch(() => null)
      const smartData = smartMoneyRes?.data as { signals?: Array<{ action?: string; token?: string; amountUsd?: number }> } | null
      const smSignals = smartData?.signals ?? []
      const accumulations = smSignals.filter(s => s.action === 'Accumulated')
      const totalAccum = accumulations.reduce((sum, s) => sum + (s.amountUsd ?? 0), 0)
      if (smSignals.length > 0) {
        signals.push({
          asset: 'Smart Money',
          direction: accumulations.length > smSignals.length / 2 ? 'bullish' : 'bearish',
          signalType: 'Whale Activity',
          confidence: Math.min(0.9, smSignals.length / 10),
          explanation: `${smSignals.length} smart money signals detected — ${accumulations.length} accumulations totaling $${(totalAccum / 1e6).toFixed(1)}M.`,
          riskReward: accumulations.length > smSignals.length / 2 ? '2:1 (favorable)' : '1:2 (unfavorable)',
          timestamp: new Date(),
        })
      }
    } catch {
      // Optional signal
    }

    // 3. Derivatives
    try {
      const derivRes = await registry.fetchOne('binance-futures', { limit: 5 }).catch(() => null)
      const topPairs = (derivRes?.data as { topPairs?: Array<{ symbol?: string; fundingRate?: number; priceChangePercent?: number }> } | null)?.topPairs ?? []
      if (topPairs.length > 0) {
        const avgFunding = topPairs.reduce((s, p) => s + (p.fundingRate ?? 0), 0) / topPairs.length
        const btcPair = topPairs.find(p => p.symbol === 'BTCUSDT')
        const btcChange = btcPair?.priceChangePercent ?? 0
        signals.push({
          asset: 'BTC Perpetuals',
          direction: avgFunding > 0.001 ? 'bearish' : avgFunding < -0.001 ? 'bullish' : 'neutral',
          signalType: 'Derivatives',
          confidence: Math.min(0.8, Math.abs(avgFunding) * 100),
          explanation: `Avg funding ${(avgFunding * 100).toFixed(4)}% — ${avgFunding > 0.001 ? 'high long leverage, reversal risk' : avgFunding < -0.001 ? 'high short leverage, squeeze risk' : 'neutral leverage'}. BTC ${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(2)}% 24h.`,
          riskReward: Math.abs(avgFunding) > 0.001 ? '1:2 (unfavorable)' : '1:1 (neutral)',
          timestamp: new Date(),
        })
      }
    } catch {
      // Optional signal
    }

    // 4. Macro
    try {
      const macroRes = await registry.fetchOne('fred', { series: 'FEDFUNDS' }).catch(() => null)
      const macroData = macroRes?.data as { observations?: Array<{ value?: string }> } | null
      const latestRate = macroData?.observations?.[0]?.value
      if (latestRate) {
        const rate = parseFloat(latestRate)
        signals.push({
          asset: 'Macro',
          direction: rate > 5 ? 'bearish' : rate < 3 ? 'bullish' : 'neutral',
          signalType: 'Macro Environment',
          confidence: 0.6,
          explanation: `Fed Funds Rate at ${rate.toFixed(2)}% — ${rate > 5 ? 'tight policy, risk-off environment' : rate < 3 ? 'accommodative policy, risk-on environment' : 'neutral monetary stance'}.`,
          riskReward: rate > 5 ? '1:2 (unfavorable)' : rate < 3 ? '2:1 (favorable)' : '1:1 (neutral)',
          timestamp: new Date(),
        })
      }
    } catch {
      // Optional signal
    }

    // Build report
    const topPick = signals.reduce((best, s) =>
      s.confidence > (best?.confidence ?? 0) ? s : best, null as EdgeSignal | null)

    const bullishCount = signals.filter(s => s.direction === 'bullish').length
    const bearishCount = signals.filter(s => s.direction === 'bearish').length
    const regime = bullishCount > bearishCount ? 'Risk-On' : bearishCount > bullishCount ? 'Risk-Off' : 'Neutral'

    cachedReport = {
      date: new Date().toISOString().split('T')[0],
      summary: `${signals.length} signals detected. ${bullishCount} bullish, ${bearishCount} bearish. Market regime: ${regime}.`,
      signals,
      topPick,
      marketRegime: regime,
      generatedAt: new Date().toISOString(),
    }
    lastReportTime = now

    return cachedReport
  } catch (err) {
    console.error('[EdgeReport] Generation failed:', (err as Error).message)
    return {
      date: new Date().toISOString().split('T')[0],
      summary: 'Report generation failed — insufficient data.',
      signals: [],
      topPick: null,
      marketRegime: 'Unknown',
      generatedAt: new Date().toISOString(),
    }
  }
}

export function getCachedReport(): EdgeReport | null {
  return cachedReport
}
