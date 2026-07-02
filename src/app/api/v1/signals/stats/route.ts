// ─────────────────────────────────────────────────────────────
// GET /api/v1/signals/stats — Win rate and signal performance
// ?symbol=BTC&period=30&source=funding-rate
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { prisma } from '@/lib/db'

interface SignalStats {
  totalSignals: number
  wins: number
  losses: number
  expired: number
  pending: number
  winRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  bySymbol: Record<string, { wins: number; losses: number; winRate: number }>
  bySource: Record<string, { wins: number; losses: number; winRate: number }>
  byDirection: Record<string, { wins: number; losses: number; winRate: number }>
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol') ?? undefined
  const period = Math.min(90, Math.max(7, parseInt(searchParams.get('period') ?? '30') || 30))
  const source = searchParams.get('source') ?? undefined

  try {
    const where: Record<string, unknown> = {
      outcome: { in: ['win', 'loss'] },
      backtestDate: { gte: new Date(Date.now() - period * 24 * 3600000) },
    }
    if (symbol) where.symbol = symbol
    if (source) where.source = source

    const results = await prisma.backtestResult.findMany({ where })

    const wins = results.filter(r => r.outcome === 'win')
    const losses = results.filter(r => r.outcome === 'loss')
    const winRate = results.length > 0 ? (wins.length / results.length) * 100 : 0
    const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / wins.length : 0
    const avgLoss = losses.length > 0 ? losses.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / losses.length : 0
    const grossProfit = wins.reduce((s, r) => s + Math.abs(r.pnlPercent ?? 0), 0)
    const grossLoss = losses.reduce((s, r) => s + Math.abs(r.pnlPercent ?? 0), 0)
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

    // Breakdown by symbol
    const bySymbol: Record<string, { wins: number; losses: number; winRate: number }> = {}
    for (const r of results) {
      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { wins: 0, losses: 0, winRate: 0 }
      if (r.outcome === 'win') bySymbol[r.symbol].wins++
      else bySymbol[r.symbol].losses++
    }
    for (const s of Object.values(bySymbol)) {
      s.winRate = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)) * 100 : 0
    }

    // Breakdown by source
    const bySource: Record<string, { wins: number; losses: number; winRate: number }> = {}
    for (const r of results) {
      if (!bySource[r.source]) bySource[r.source] = { wins: 0, losses: 0, winRate: 0 }
      if (r.outcome === 'win') bySource[r.source].wins++
      else bySource[r.source].losses++
    }
    for (const s of Object.values(bySource)) {
      s.winRate = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)) * 100 : 0
    }

    // Breakdown by direction
    const byDirection: Record<string, { wins: number; losses: number; winRate: number }> = {}
    for (const r of results) {
      if (!byDirection[r.direction]) byDirection[r.direction] = { wins: 0, losses: 0, winRate: 0 }
      if (r.outcome === 'win') byDirection[r.direction].wins++
      else byDirection[r.direction].losses++
    }
    for (const s of Object.values(byDirection)) {
      s.winRate = (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)) * 100 : 0
    }

    const stats: SignalStats = {
      totalSignals: results.length,
      wins: wins.length,
      losses: losses.length,
      expired: 0,
      pending: 0,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      bySymbol,
      bySource,
      byDirection,
    }

    return apiJson({ stats, period })

  } catch (err) {
    console.error('Signal stats error:', err)
    return apiError('Failed to get signal stats', 502)
  }
}
