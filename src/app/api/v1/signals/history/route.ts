// ─────────────────────────────────────────────────────────────
// GET /api/v1/signals/history — Signal history with PnL
// Pagination: ?cursor=<id>&limit=30
// Filter:     ?outcome=win|loss|expired|all&q=BTC
// Sort:       ?sort=date|pnl|outcome (default: date desc)
// ─────────────────────────────────────────────────────────────

import { apiJson, apiError } from '@/lib/api/response'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

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
  outcome: 'win' | 'loss' | 'expired' | 'not_triggered' | null
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

// Global stats (not paginated, cached per request)
async function getGlobalStats() {
  const [total, wins, losses, expired, pending] = await Promise.all([
    prisma.backtestResult.count({ where: { outcome: { not: 'pending' } } }),
    prisma.backtestResult.count({ where: { outcome: 'win' } }),
    prisma.backtestResult.count({ where: { outcome: 'loss' } }),
    prisma.backtestResult.count({ where: { outcome: 'expired' } }),
    prisma.backtestResult.count({ where: { outcome: 'pending' } }),
  ])
  const completed = wins + losses
  const winRate = completed > 0 ? Math.round((wins / completed) * 10000) / 100 : 0

  // Avg PnL from DB aggregates (faster than fetching all rows)
  const aggResult = await prisma.$queryRaw<{ avg_win: number | null; avg_loss: number | null; total_pnl: number | null }[]>`
    SELECT
      AVG(CASE WHEN outcome = 'win' THEN "pnlPercent" END) as avg_win,
      AVG(CASE WHEN outcome = 'loss' THEN "pnlPercent" END) as avg_loss,
      SUM("pnlPercent") as total_pnl
    FROM "BacktestResult"
    WHERE outcome IN ('win', 'loss')
  `
  const agg = aggResult[0]

  return {
    total,
    pending,
    wins,
    losses,
    expired,
    winRate,
    totalPnl: Math.round((agg?.total_pnl ?? 0) * 100) / 100,
    avgWin: Math.round((agg?.avg_win ?? 0) * 100) / 100,
    avgLoss: Math.round((agg?.avg_loss ?? 0) * 100) / 100,
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // Pagination
  const cursor = searchParams.get('cursor') ?? undefined
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '30') || 30))

  // Filters
  const outcomeParam = searchParams.get('outcome') ?? 'all'
  const query = searchParams.get('q')?.trim().toUpperCase() ?? ''

  // Sort
  const sort = searchParams.get('sort') ?? 'date'

  try {
    // Build where clause for completed signals
    const where: Prisma.BacktestResultWhereInput = {}

    // Outcome filter
    if (outcomeParam === 'all') {
      where.outcome = { in: ['win', 'loss', 'expired', 'not_triggered'] }
    } else if (['win', 'loss', 'expired', 'not_triggered'].includes(outcomeParam)) {
      where.outcome = outcomeParam
    } else {
      where.outcome = { in: ['win', 'loss', 'expired', 'not_triggered'] }
    }

    // Symbol search (case-insensitive prefix match)
    if (query) {
      where.symbol = { startsWith: query, mode: 'insensitive' }
    }

    // Build order by
    let orderBy: Prisma.BacktestResultOrderByWithRelationInput
    switch (sort) {
      case 'pnl':
        orderBy = { pnlPercent: 'desc' }
        break
      case 'outcome':
        // Custom ordering: win > expired > loss
        orderBy = { outcome: 'asc' }
        break
      case 'date':
      default:
        orderBy = { backtestDate: 'desc' }
        break
    }

    // Cursor-based pagination
    const findArgs: Prisma.BacktestResultFindManyArgs = {
      where,
      orderBy,
      take: limit + 1, // fetch one extra to detect if there's more
    }
    if (cursor) {
      findArgs.cursor = { id: cursor }
      findArgs.skip = 1 // skip the cursor itself
    }

    const rows = await prisma.backtestResult.findMany(findArgs)
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? pageRows[pageRows.length - 1].id : null

    // Format completed signals
    const signals: SignalHistoryItem[] = pageRows.map(r => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      entry: r.entryPrice,
      tp1: r.tp1,
      tp2: r.tp2,
      tp3: r.tp3,
      sl: r.sl,
      status: 'completed' as const,
      outcome: r.outcome as 'win' | 'loss' | 'expired' | 'not_triggered',
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

    // Fetch global stats in parallel (only on first page)
    const stats = cursor ? null : await getGlobalStats()

    return apiJson({
      signals,
      nextCursor,
      hasMore,
      count: signals.length,
      ...(stats ? { stats } : {}),
    })

  } catch (err) {
    console.error('Signal history error:', err)
    return apiError('Failed to get signal history', 502)
  }
}
