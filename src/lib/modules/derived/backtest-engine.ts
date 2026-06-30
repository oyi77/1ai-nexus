// ─────────────────────────────────────────────────────────────
// Backtest Engine
// Replays historical snapshots vs actual price outcomes
// Calculates accuracy metrics per module
// Uses Prisma-persisted snapshots for historical data
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface BacktestResult {
  module: string
  totalSignals: number
  correctPredictions: number
  accuracy: number // 0-100
  avgConfidence: number
  signals: BacktestSignal[]
}

export interface BacktestSignal {
  timestamp: string
  predicted: 'bullish' | 'bearish' | 'neutral'
  actual: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  correct: boolean
  priceChange: number | null
}

export interface BacktestReport {
  period: { from: string; to: string }
  modules: BacktestResult[]
  overall: {
    totalSignals: number
    totalCorrect: number
    accuracy: number
  }
  timestamp: string
}

// ─── Price Outcome ──────────────────────────────────────────

async function fetchPriceAtDate(date: Date): Promise<number | null> {
  try {
    // Use CoinGecko for historical BTC price
    const dateStr = date.toISOString().slice(0, 10)
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${dateStr}&localization=false`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { market_data?: { current_price?: { usd?: number } } }
    return data.market_data?.current_price?.usd ?? null
  } catch { return null }
}

function classifyOutcome(priceChange: number): 'bullish' | 'bearish' | 'neutral' {
  if (priceChange > 2) return 'bullish'
  if (priceChange < -2) return 'bearish'
  return 'neutral'
}

// ─── Module Backtesters ─────────────────────────────────────

async function backtestDerivatives(from: Date, to: Date): Promise<BacktestResult> {
  const snapshots = await prisma.derivativesSnapshot.findMany({
    where: { timestamp: { gte: from, lte: to } },
    orderBy: { timestamp: 'asc' },
  })

  // Group by hour and compute average funding
  const hourly = new Map<string, { avgFunding: number; count: number }>()
  for (const snap of snapshots) {
    const hour = snap.timestamp.toISOString().slice(0, 13)
    const existing = hourly.get(hour) ?? { avgFunding: 0, count: 0 }
    existing.avgFunding += snap.fundingRate
    existing.count++
    hourly.set(hour, existing)
  }

  const signals: BacktestSignal[] = []
  for (const [hour, data] of hourly) {
    const avgFunding = data.avgFunding / data.count
    const predicted = avgFunding > 0.01 ? 'bullish' : avgFunding < -0.01 ? 'bearish' : 'neutral'
    const confidence = Math.min(100, Math.abs(avgFunding) * 5000)

    // Check price 24h later
    const futureDate = new Date(new Date(hour).getTime() + 24 * 60 * 60 * 1000)
    if (futureDate > new Date()) continue

    const priceBefore = await fetchPriceAtDate(new Date(hour))
    const priceAfter = await fetchPriceAtDate(futureDate)

    if (priceBefore && priceAfter) {
      const priceChange = ((priceAfter - priceBefore) / priceBefore) * 100
      const actual = classifyOutcome(priceChange)
      signals.push({
        timestamp: hour,
        predicted,
        actual,
        confidence,
        correct: predicted === actual,
        priceChange,
      })
    }
  }

  const correct = signals.filter(s => s.correct).length
  return {
    module: 'Derivatives',
    totalSignals: signals.length,
    correctPredictions: correct,
    accuracy: signals.length > 0 ? (correct / signals.length) * 100 : 0,
    avgConfidence: signals.length > 0 ? signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length : 0,
    signals,
  }
}

async function backtestSentiment(from: Date, to: Date): Promise<BacktestResult> {
  const snapshots = await prisma.sentimentSnapshot.findMany({
    where: { timestamp: { gte: from, lte: to }, source: 'fear_greed' },
    orderBy: { timestamp: 'asc' },
  })

  const signals: BacktestSignal[] = []
  for (const snap of snapshots) {
    const predicted = snap.score > 60 ? 'bullish' : snap.score < 40 ? 'bearish' : 'neutral'
    const confidence = Math.abs(snap.score - 50) * 2

    const futureDate = new Date(snap.timestamp.getTime() + 24 * 60 * 60 * 1000)
    if (futureDate > new Date()) continue

    const priceBefore = await fetchPriceAtDate(snap.timestamp)
    const priceAfter = await fetchPriceAtDate(futureDate)

    if (priceBefore && priceAfter) {
      const priceChange = ((priceAfter - priceBefore) / priceBefore) * 100
      const actual = classifyOutcome(priceChange)
      signals.push({
        timestamp: snap.timestamp.toISOString(),
        predicted,
        actual,
        confidence,
        correct: predicted === actual,
        priceChange,
      })
    }
  }

  const correct = signals.filter(s => s.correct).length
  return {
    module: 'Sentiment',
    totalSignals: signals.length,
    correctPredictions: correct,
    accuracy: signals.length > 0 ? (correct / signals.length) * 100 : 0,
    avgConfidence: signals.length > 0 ? signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length : 0,
    signals,
  }
}

async function backtestSectorFlow(from: Date, to: Date): Promise<BacktestResult> {
  const snapshots = await prisma.sectorFlowSnapshot.findMany({
    where: { timestamp: { gte: from, lte: to } },
    orderBy: { timestamp: 'asc' },
  })

  // Group by day, count inflows vs outflows
  const daily = new Map<string, { inflows: number; outflows: number }>()
  for (const snap of snapshots) {
    const day = snap.timestamp.toISOString().slice(0, 10)
    const existing = daily.get(day) ?? { inflows: 0, outflows: 0 }
    if (snap.netSmartMoneyFlowUsd > 3) existing.inflows++
    else if (snap.netSmartMoneyFlowUsd < -3) existing.outflows++
    daily.set(day, existing)
  }

  const signals: BacktestSignal[] = []
  for (const [day, data] of daily) {
    const predicted = data.inflows > data.outflows * 1.5 ? 'bullish' : data.outflows > data.inflows * 1.5 ? 'bearish' : 'neutral'
    const confidence = Math.min(100, Math.abs(data.inflows - data.outflows) * 10)

    const futureDate = new Date(new Date(day).getTime() + 24 * 60 * 60 * 1000)
    if (futureDate > new Date()) continue

    const priceBefore = await fetchPriceAtDate(new Date(day))
    const priceAfter = await fetchPriceAtDate(futureDate)

    if (priceBefore && priceAfter) {
      const priceChange = ((priceAfter - priceBefore) / priceBefore) * 100
      const actual = classifyOutcome(priceChange)
      signals.push({
        timestamp: day,
        predicted,
        actual,
        confidence,
        correct: predicted === actual,
        priceChange,
      })
    }
  }

  const correct = signals.filter(s => s.correct).length
  return {
    module: 'Narrative/Sector',
    totalSignals: signals.length,
    correctPredictions: correct,
    accuracy: signals.length > 0 ? (correct / signals.length) * 100 : 0,
    avgConfidence: signals.length > 0 ? signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length : 0,
    signals,
  }
}

// ─── Main Backtest Runner ───────────────────────────────────

export async function runBacktest(days: number = 30): Promise<BacktestReport> {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  const [derivatives, sentiment, sectorFlow] = await Promise.allSettled([
    backtestDerivatives(from, to),
    backtestSentiment(from, to),
    backtestSectorFlow(from, to),
  ])

  const modules: BacktestResult[] = [
    derivatives.status === 'fulfilled' ? derivatives.value : { module: 'Derivatives', totalSignals: 0, correctPredictions: 0, accuracy: 0, avgConfidence: 0, signals: [] },
    sentiment.status === 'fulfilled' ? sentiment.value : { module: 'Sentiment', totalSignals: 0, correctPredictions: 0, accuracy: 0, avgConfidence: 0, signals: [] },
    sectorFlow.status === 'fulfilled' ? sectorFlow.value : { module: 'Narrative/Sector', totalSignals: 0, correctPredictions: 0, accuracy: 0, avgConfidence: 0, signals: [] },
  ]

  const totalSignals = modules.reduce((s, m) => s + m.totalSignals, 0)
  const totalCorrect = modules.reduce((s, m) => s + m.correctPredictions, 0)

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    modules,
    overall: {
      totalSignals,
      totalCorrect,
      accuracy: totalSignals > 0 ? (totalCorrect / totalSignals) * 100 : 0,
    },
    timestamp: new Date().toISOString(),
  }
}
