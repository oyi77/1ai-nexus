// ─────────────────────────────────────────────────────────────
// POST /api/v1/position-size — Position sizing calculator
// Kelly Criterion and fixed percentage methods
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'

interface PositionSizeRequest {
  portfolioSize: number
  riskPercent?: number  // 1-5% fixed risk
  method?: 'kelly' | 'fixed'
  winRate?: number      // Required for Kelly
  avgWin?: number       // Required for Kelly
  avgLoss?: number      // Required for Kelly
  entryPrice: number
  stopLoss: number
}

interface PositionSizeResult {
  method: string
  positionSize: number      // Units to buy/sell
  riskAmount: number        // USD at risk
  riskPercent: number       // % of portfolio
  potentialReward: number   // USD potential profit
  riskRewardRatio: number   // R:R ratio
  kellyFraction?: number    // Kelly % (if method=kelly)
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as PositionSizeRequest
    const { portfolioSize, riskPercent = 2, method = 'fixed', winRate, avgWin, avgLoss, entryPrice, stopLoss } = body

    // Validate inputs
    if (!portfolioSize || portfolioSize <= 0) return apiError('Invalid portfolio size', 400)
    if (!entryPrice || entryPrice <= 0) return apiError('Invalid entry price', 400)
    if (!stopLoss || stopLoss <= 0) return apiError('Invalid stop loss', 400)
    if (entryPrice === stopLoss) return apiError('Entry and stop loss cannot be equal', 400)

    const riskPerUnit = Math.abs(entryPrice - stopLoss)
    const riskPercentDecimal = riskPercent / 100

    let positionSizeUsd: number
    let kellyFraction: number | undefined

    if (method === 'kelly' && winRate && avgWin && avgLoss) {
      // Kelly Criterion: f = (bp - q) / b
      // b = avgWin/avgLoss, p = winRate, q = 1 - winRate
      const b = avgWin / Math.abs(avgLoss)
      const p = winRate / 100
      const q = 1 - p
      kellyFraction = Math.max(0, (b * p - q) / b)

      // Cap Kelly at 25% for safety
      const cappedKelly = Math.min(kellyFraction, 0.25)
      positionSizeUsd = portfolioSize * cappedKelly
    } else {
      // Fixed percentage method
      positionSizeUsd = portfolioSize * riskPercentDecimal
    }

    const positionSize = positionSizeUsd / riskPerUnit
    const riskAmount = positionSize * riskPerUnit
    const potentialReward = positionSize * riskPerUnit * 2 // Assume 2:1 R:R for display

    const result: PositionSizeResult = {
      method,
      positionSize: Math.floor(positionSize * 100) / 100,
      riskAmount: Math.floor(riskAmount * 100) / 100,
      riskPercent: (riskAmount / portfolioSize) * 100,
      potentialReward: Math.floor(potentialReward * 100) / 100,
      riskRewardRatio: 2, // Default 2:1
      kellyFraction: kellyFraction ? Math.floor(kellyFraction * 10000) / 100 : undefined,
    }

    return apiJson(result)

  } catch (err) {
    console.error('Position size error:', err)
    return apiError('Failed to calculate position size', 502)
  }
}
