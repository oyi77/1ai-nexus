// ─────────────────────────────────────────────────────────────
// GET /api/v1/signals/history — Signal history with PnL
// ?status=active|completed|all&symbol=BTC&limit=50
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { prisma } from '@/lib/db'

interface SignalHistoryItem {
  id: string
  symbol: string
  direction: string
  entry: number
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  status: 'active' | 'completed'
  outcome: 'win' | 'loss' | 'expired' | null
  exitPrice: number | null
  pnlPercent: number | null
  hitTarget: string | null
  source: string
  strength: number
  confidence: number
  validPeriod: string
  createdAt: string
  closedAt: string | null
  durationHours: number | null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'all'
  const symbol = searchParams.get('symbol') ?? undefined
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50') || 50))

  try {
    // Get active signals from alpha engine
    const activeRes = await fetch('http://localhost:4400/api/v1/alpha-engine', {
      signal: AbortSignal.timeout(10_000),
    })
    const activeData = await activeRes.json() as { data?: { signals?: Array<{
      id: string; symbol: string; direction: string;
      entry: number | null; tp1: number | null; tp2: number | null; tp3: number | null; sl: number | null;
      sources: string[]; strength: number; confidence: number; validPeriod: string; expiresAt: number; timestamp: number;
    }> } }
    const activeSignals = activeData.data?.signals ?? []

    // Get completed signals from backtest results
    const completedWhere: Record<string, unknown> = {
      outcome: { in: ['win', 'loss', 'expired', 'pending'] },
    }
    if (symbol) completedWhere.symbol = symbol

    const completedResults = await prisma.backtestResult.findMany({
      where: completedWhere,
      orderBy: { backtestDate: 'desc' },
      take: limit,
    })

    // Format active signals
    const active: SignalHistoryItem[] = activeSignals
      .filter(s => !symbol || s.symbol === symbol)
      .filter(s => s.entry && s.sl) // Only signals with trading levels
      .map(s => ({
        id: s.id,
        symbol: s.symbol,
        direction: s.direction,
        entry: s.entry!,
        tp1: s.tp1,
        tp2: s.tp2,
        tp3: s.tp3,
        sl: s.sl,
        status: 'active' as const,
        outcome: null,
        exitPrice: null,
        pnlPercent: null,
        hitTarget: null,
        source: s.sources[0] ?? 'unknown',
        strength: s.strength,
        confidence: s.confidence,
        validPeriod: s.validPeriod,
        createdAt: new Date(s.timestamp).toISOString(),
        closedAt: null,
        durationHours: null,
      }))

    // Format completed signals
    const completed: SignalHistoryItem[] = completedResults.map(r => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      entry: r.entryPrice,
      tp1: r.tp1,
      tp2: r.tp2,
      tp3: r.tp3,
      sl: r.sl,
      status: 'completed' as const,
      outcome: r.outcome as 'win' | 'loss' | 'expired',
      exitPrice: r.exitPrice,
      pnlPercent: r.pnlPercent,
      hitTarget: r.hitTarget,
      source: r.source,
      strength: 0,
      confidence: 0,
      validPeriod: '24h',
      createdAt: r.backtestDate.toISOString(),
      closedAt: r.createdAt.toISOString(),
      durationHours: r.durationHours,
    }))

    // Calculate stats
    const wins = completed.filter(c => c.outcome === 'win')
    const losses = completed.filter(c => c.outcome === 'loss')
    const totalPnl = completed.reduce((sum, c) => sum + (c.pnlPercent ?? 0), 0)
    const avgPnl = completed.length > 0 ? totalPnl / completed.length : 0
    const winRate = completed.length > 0 ? (wins.length / completed.length) * 100 : 0

    // Return based on status filter
    let results: SignalHistoryItem[]
    if (status === 'active') {
      results = active
    } else if (status === 'completed') {
      results = completed
    } else {
      results = [...active, ...completed].slice(0, limit)
    }

    return apiJson({
      signals: results,
      stats: {
        active: active.length,
        completed: completed.length,
        wins: wins.length,
        losses: losses.length,
        winRate: Math.round(winRate * 100) / 100,
        totalPnl: Math.round(totalPnl * 100) / 100,
        avgPnl: Math.round(avgPnl * 100) / 100,
      },
      count: results.length,
    })

  } catch (err) {
    console.error('Signal history error:', err)
    return apiError('Failed to get signal history', 502)
  }
}
