// ─────────────────────────────────────────────────────────────
// GET /api/v1/risk/drawdown — Portfolio drawdown monitoring
// Tracks equity curve and alerts on max drawdown threshold
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { prisma } from '@/lib/db'

interface DrawdownResult {
  currentDrawdown: number    // % from peak
  maxDrawdown: number        // Max drawdown in period
  peakEquity: number         // Highest equity point
  currentEquity: number      // Current equity
  drawdownAlert: boolean     // True if exceeds threshold
  threshold: number          // Alert threshold %
  period: number             // Days analyzed
  equityCurve: Array<{ date: string; equity: number; drawdown: number }>
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const period = Math.min(90, Math.max(7, parseInt(searchParams.get('period') ?? '30') || 30))
  const threshold = Math.min(50, Math.max(5, parseInt(searchParams.get('threshold') ?? '20') || 20))

  try {
    // Get completed signal outcomes
    const results = await prisma.backtestResult.findMany({
      where: {
        outcome: { in: ['win', 'loss'] },
        backtestDate: { gte: new Date(Date.now() - period * 24 * 3600000) },
      },
      orderBy: { backtestDate: 'asc' },
    })

    if (results.length === 0) {
      return apiJson({
        currentDrawdown: 0,
        maxDrawdown: 0,
        peakEquity: 100,
        currentEquity: 100,
        drawdownAlert: false,
        threshold,
        period,
        equityCurve: [],
      })
    }

    // Build equity curve
    let equity = 100
    let peak = 100
    let maxDrawdown = 0
    const equityCurve: Array<{ date: string; equity: number; drawdown: number }> = []

    for (const r of results) {
      equity *= 1 + (r.pnlPercent ?? 0) / 100
      peak = Math.max(peak, equity)
      const drawdown = (peak - equity) / peak
      maxDrawdown = Math.max(maxDrawdown, drawdown)

      equityCurve.push({
        date: r.backtestDate.toISOString().slice(0, 10),
        equity: Math.floor(equity * 100) / 100,
        drawdown: Math.floor(drawdown * 10000) / 100,
      })
    }

    const currentDrawdown = (peak - equity) / peak

    const result: DrawdownResult = {
      currentDrawdown: Math.floor(currentDrawdown * 10000) / 100,
      maxDrawdown: Math.floor(maxDrawdown * 10000) / 100,
      peakEquity: Math.floor(peak * 100) / 100,
      currentEquity: Math.floor(equity * 100) / 100,
      drawdownAlert: currentDrawdown * 100 > threshold,
      threshold,
      period,
      equityCurve: equityCurve.slice(-30), // Last 30 data points
    }

    return apiJson(result)

  } catch (err) {
    console.error('Drawdown error:', err)
    return apiError('Failed to calculate drawdown', 502)
  }
}
