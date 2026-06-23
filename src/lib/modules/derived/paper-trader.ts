// ─────────────────────────────────────────────────────────────
// Paper Trading / Prediction Tracker
// Record predictions, track accuracy over time
// All real data, zero mock
// ─────────────────────────────────────────────────────────────

export interface Prediction {
  id: string
  symbol: string
  direction: 'long' | 'short'
  entryPrice: number
  targetPrice?: number
  stopLoss?: number
  confidence: number
  source: string
  reasoning: string
  timestamp: number
  expiresAt: number
  status: 'open' | 'closed'
  exitPrice?: number
  exitTimestamp?: number
  pnlPercent?: number
  outcome?: 'win' | 'loss' | 'breakeven' | 'expired'
}

const predictions: Prediction[] = []

export function recordPrediction(p: Omit<Prediction, 'id' | 'status' | 'timestamp'>): Prediction {
  const pred: Prediction = {
    ...p,
    id: `pred-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'open',
    timestamp: Date.now(),
  }
  predictions.push(pred)
  return pred
}

export function closePrediction(id: string, exitPrice: number): Prediction | null {
  const pred = predictions.find(p => p.id === id && p.status === 'open')
  if (!pred) return null

  pred.exitPrice = exitPrice
  pred.exitTimestamp = Date.now()
  pred.status = 'closed'

  if (pred.direction === 'long') {
    pred.pnlPercent = ((exitPrice - pred.entryPrice) / pred.entryPrice) * 100
  } else {
    pred.pnlPercent = ((pred.entryPrice - exitPrice) / pred.entryPrice) * 100
  }

  if (pred.pnlPercent > 0.1) pred.outcome = 'win'
  else if (pred.pnlPercent < -0.1) pred.outcome = 'loss'
  else pred.outcome = 'breakeven'

  return pred
}

export function getOpenPredictions(): Prediction[] {
  return predictions.filter(p => p.status === 'open')
}

export function getClosedPredictions(): Prediction[] {
  return predictions.filter(p => p.status === 'closed')
}

export function getAccuracy(): { total: number; wins: number; losses: number; winRate: number; avgPnl: number } {
  const closed = predictions.filter(p => p.status === 'closed')
  const wins = closed.filter(p => p.outcome === 'win').length
  const losses = closed.filter(p => p.outcome === 'loss').length
  const total = closed.length
  const avgPnl = total > 0 ? closed.reduce((s, p) => s + (p.pnlPercent ?? 0), 0) / total : 0

  return {
    total,
    wins,
    losses,
    winRate: total > 0 ? (wins / total) * 100 : 0,
    avgPnl,
  }
}

export function getPredictionsBySymbol(symbol: string): Prediction[] {
  return predictions.filter(p => p.symbol.toUpperCase() === symbol.toUpperCase())
}

export function getAllPredictions(): Prediction[] {
  return [...predictions]
}