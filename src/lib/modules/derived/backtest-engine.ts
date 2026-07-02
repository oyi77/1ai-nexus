// ─────────────────────────────────────────────────────────────
// Backtest Engine — Replay HISTORICAL signals against price data
// Signals are stored over time; backtest queries past signals
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface BacktestSignal {
  id: string
  symbol: string
  direction: 'bullish' | 'bearish'
  entry: number
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  timestamp: number
  source: string
}

export interface BacktestResult {
  id: string
  symbol: string
  direction: string
  entryPrice: number
  tp1: number | null
  tp2: number | null
  tp3: number | null
  sl: number | null
  outcome: 'win' | 'loss' | 'expired'
  exitPrice: number | null
  pnlPercent: number | null
  hitTarget: string | null
  durationHours: number | null
  source: string
  signalId: string | null
  backtestDate: Date
}

export interface BacktestStats {
  totalSignals: number
  wins: number
  losses: number
  expired: number
  winRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxDrawdown: number
  avgDurationHours: number
}

// Fetch historical OHLCV data from Binance with pagination
async function fetchHistoricalPrices(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<Array<{ time: number; high: number; low: number; close: number }>> {
  const allCandles: Array<{ time: number; high: number; low: number; close: number }> = []
  let currentStart = startTime
  const interval = '1h'

  // Paginate to get all data (Binance limit=1000 per request)
  while (currentStart < endTime) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&startTime=${currentStart}&endTime=${endTime}&limit=1000`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) break

      const data = (await res.json()) as Array<[number, string, string, string, string, string]>
      if (data.length === 0) break

      for (const k of data) {
        allCandles.push({
          time: k[0],
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        })
      }

      // Move start past last candle
      currentStart = data[data.length - 1][0] + 1

      // Stop if we got less than limit (no more data)
      if (data.length < 1000) break
    } catch {
      break
    }
  }

  return allCandles
}

// Check if a signal hit TP or SL
// Note: When both SL and TP fall within same candle, SL is checked first (conservative)
function checkOutcome(
  candles: Array<{ time: number; high: number; low: number; close: number }>,
  signal: BacktestSignal
): { outcome: 'win' | 'loss' | 'expired'; exitPrice: number | null; hitTarget: string | null; durationHours: number | null } {
  if (!signal.entry || !signal.sl) {
    return { outcome: 'expired', exitPrice: null, hitTarget: null, durationHours: null }
  }

  const isBullish = signal.direction === 'bullish'
  const entryTime = signal.timestamp

  for (const candle of candles) {
    // Skip candles before or at signal time
    if (candle.time <= entryTime) continue

    // Check SL first (conservative: if both in same candle, SL wins)
    if (isBullish) {
      if (candle.low <= signal.sl) {
        return { outcome: 'loss', exitPrice: signal.sl, hitTarget: 'sl', durationHours: (candle.time - entryTime) / 3600000 }
      }
    } else {
      if (candle.high >= signal.sl) {
        return { outcome: 'loss', exitPrice: signal.sl, hitTarget: 'sl', durationHours: (candle.time - entryTime) / 3600000 }
      }
    }

    // Check TP targets (closest first)
    const targets = [
      { price: signal.tp1, name: 'tp1' },
      { price: signal.tp2, name: 'tp2' },
      { price: signal.tp3, name: 'tp3' },
    ].filter(t => t.price !== null)

    for (const target of targets) {
      if (isBullish && candle.high >= target.price!) {
        return { outcome: 'win', exitPrice: target.price!, hitTarget: target.name, durationHours: (candle.time - entryTime) / 3600000 }
      }
      if (!isBullish && candle.low <= target.price!) {
        return { outcome: 'win', exitPrice: target.price!, hitTarget: target.name, durationHours: (candle.time - entryTime) / 3600000 }
      }
    }
  }

  // No TP or SL hit - use last candle close as exit
  const lastCandle = candles[candles.length - 1]
  if (lastCandle) {
    return {
      outcome: 'expired',
      exitPrice: lastCandle.close,
      hitTarget: null,
      durationHours: (lastCandle.time - entryTime) / 3600000,
    }
  }

  return { outcome: 'expired', exitPrice: null, hitTarget: null, durationHours: null }
}

// Store a signal for future backtesting
export async function storeSignal(signal: BacktestSignal): Promise<void> {
  await prisma.backtestResult.create({
    data: {
      id: `signal-${signal.id}`,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entry,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      sl: signal.sl,
      outcome: 'pending',
      source: signal.source,
      signalId: signal.id,
      backtestDate: new Date(signal.timestamp),
    },
  })
}

// Run backtest on STORED historical signals
export async function runBacktest(
  periodDays: number = 30
): Promise<{ results: BacktestResult[]; stats: BacktestStats }> {
  // Clamp period to valid range
  const clampedDays = Math.min(90, Math.max(7, periodDays))
  const now = Date.now()
  const startTime = now - clampedDays * 24 * 60 * 60 * 1000

  // Get stored signals that are old enough to backtest (at least 24h old)
  const minSignalAge = now - 24 * 60 * 60 * 1000
  const storedSignals = await prisma.backtestResult.findMany({
    where: {
      outcome: 'pending',
      backtestDate: {
        gte: new Date(startTime),
        lte: new Date(minSignalAge),
      },
    },
    orderBy: { backtestDate: 'desc' },
    take: 500,
  })

  if (storedSignals.length === 0) {
    return { results: [], stats: emptyStats() }
  }

  // Group by symbol for efficient price fetching
  const bySymbol = new Map<string, typeof storedSignals>()
  for (const s of storedSignals) {
    const existing = bySymbol.get(s.symbol) ?? []
    existing.push(s)
    bySymbol.set(s.symbol, existing)
  }

  const results: BacktestResult[] = []

  for (const [symbol, signals] of bySymbol) {
    // Fetch price data from signal time to now
    const earliestSignal = Math.min(...signals.map(s => s.backtestDate.getTime()))
    const candles = await fetchHistoricalPrices(symbol, earliestSignal, now)
    if (candles.length === 0) continue

    for (const signal of signals) {
      const backtestSignal: BacktestSignal = {
        id: signal.signalId ?? signal.id,
        symbol: signal.symbol,
        direction: signal.direction as 'bullish' | 'bearish',
        entry: signal.entryPrice,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        sl: signal.sl,
        timestamp: signal.backtestDate.getTime(),
        source: signal.source,
      }

      const { outcome, exitPrice, hitTarget, durationHours } = checkOutcome(candles, backtestSignal)

      let pnlPercent: number | null = null
      if (exitPrice && signal.entryPrice) {
        pnlPercent = backtestSignal.direction === 'bullish'
          ? ((exitPrice - signal.entryPrice) / signal.entryPrice) * 100
          : ((signal.entryPrice - exitPrice) / signal.entryPrice) * 100
      }

      results.push({
        id: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        sl: signal.sl,
        outcome,
        exitPrice,
        pnlPercent,
        hitTarget,
        durationHours,
        source: signal.source,
        signalId: signal.signalId,
        backtestDate: signal.backtestDate,
      })
    }
  }

  // Update outcomes in DB (batch update)
  for (const result of results) {
    await prisma.backtestResult.update({
      where: { id: result.id },
      data: {
        outcome: result.outcome,
        exitPrice: result.exitPrice,
        pnlPercent: result.pnlPercent,
        hitTarget: result.hitTarget,
        durationHours: result.durationHours,
      },
    })
  }

  return { results, stats: calculateStats(results) }
}

function calculateStats(results: BacktestResult[]): BacktestStats {
  const wins = results.filter(r => r.outcome === 'win')
  const losses = results.filter(r => r.outcome === 'loss')
  const expired = results.filter(r => r.outcome === 'expired')
  const winRate = results.length > 0 ? (wins.length / results.length) * 100 : 0
  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / losses.length : 0
  const grossProfit = wins.reduce((s, r) => s + Math.abs(r.pnlPercent ?? 0), 0)
  const grossLoss = losses.reduce((s, r) => s + Math.abs(r.pnlPercent ?? 0), 0)
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  let maxDrawdown = 0, peak = 0, equity = 100
  for (const r of results) {
    equity *= 1 + (r.pnlPercent ?? 0) / 100
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak)
  }

  const avgDurationHours = results.length > 0
    ? results.reduce((s, r) => s + (r.durationHours ?? 0), 0) / results.length
    : 0

  return { totalSignals: results.length, wins: wins.length, losses: losses.length, expired: expired.length, winRate, avgWin, avgLoss, profitFactor, maxDrawdown: maxDrawdown * 100, avgDurationHours }
}

function emptyStats(): BacktestStats {
  return { totalSignals: 0, wins: 0, losses: 0, expired: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, maxDrawdown: 0, avgDurationHours: 0 }
}

// Get completed backtest results from DB
export async function getBacktestResults(symbol?: string, periodDays?: number, limit = 100): Promise<BacktestResult[]> {
  const where: Record<string, unknown> = { outcome: { not: 'pending' } }
  if (symbol) where.symbol = symbol
  if (periodDays) where.backtestDate = { gte: new Date(Date.now() - periodDays * 24 * 3600000) }

  const results = await prisma.backtestResult.findMany({ where, orderBy: { backtestDate: 'desc' }, take: limit })
  return results.map(r => ({
    id: r.id, symbol: r.symbol, direction: r.direction, entryPrice: r.entryPrice,
    tp1: r.tp1, tp2: r.tp2, tp3: r.tp3, sl: r.sl,
    outcome: r.outcome as 'win' | 'loss' | 'expired', exitPrice: r.exitPrice,
    pnlPercent: r.pnlPercent, hitTarget: r.hitTarget, durationHours: r.durationHours,
    source: r.source, signalId: r.signalId, backtestDate: r.backtestDate,
  }))
}

// Get aggregated stats from DB
export async function getBacktestStats(symbol?: string, periodDays?: number): Promise<BacktestStats> {
  const results = await getBacktestResults(symbol, periodDays, 10000)
  return calculateStats(results)
}

// Check and update expired signal outcomes (run hourly via cron)
export async function checkExpiredSignals(): Promise<{ checked: number; updated: number; wins: number; losses: number }> {
  // Get pending signals older than 24 hours
  const minAge = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const pending = await prisma.backtestResult.findMany({
    where: {
      outcome: 'pending',
      backtestDate: { lte: minAge },
    },
    take: 100,
  })

  if (pending.length === 0) return { checked: 0, updated: 0, wins: 0, losses: 0 }

  // Group by symbol for efficient price fetching
  const bySymbol = new Map<string, typeof pending>()
  for (const s of pending) {
    const existing = bySymbol.get(s.symbol) ?? []
    existing.push(s)
    bySymbol.set(s.symbol, existing)
  }

  let wins = 0, losses = 0, updated = 0

  for (const [symbol, signals] of bySymbol) {
    const earliest = Math.min(...signals.map(s => s.backtestDate.getTime()))
    const candles = await fetchHistoricalPrices(symbol, earliest, Date.now())
    if (candles.length === 0) continue

    for (const signal of signals) {
      const backtestSignal: BacktestSignal = {
        id: signal.signalId ?? signal.id,
        symbol: signal.symbol,
        direction: signal.direction as 'bullish' | 'bearish',
        entry: signal.entryPrice,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        sl: signal.sl,
        timestamp: signal.backtestDate.getTime(),
        source: signal.source,
      }

      const { outcome, exitPrice, hitTarget, durationHours } = checkOutcome(candles, backtestSignal)

      // Only update if we have a definitive outcome (win/loss)
      if (outcome === 'win' || outcome === 'loss') {
        const pnlPercent = backtestSignal.direction === 'bullish'
          ? ((exitPrice! - signal.entryPrice) / signal.entryPrice) * 100
          : ((signal.entryPrice - exitPrice!) / signal.entryPrice) * 100

        await prisma.backtestResult.update({
          where: { id: signal.id },
          data: { outcome, exitPrice, pnlPercent, hitTarget, durationHours },
        })

        if (outcome === 'win') wins++
        else losses++
        updated++
      }
    }
  }

  return { checked: pending.length, updated, wins, losses }
}

// Get pending signals count
export async function getPendingSignalsCount(): Promise<number> {
  return prisma.backtestResult.count({ where: { outcome: 'pending' } })
}

// Get signal outcomes summary
export async function getSignalOutcomesSummary(): Promise<{
  total: number
  pending: number
  wins: number
  losses: number
  expired: number
}> {
  const [total, pending, wins, losses, expired] = await Promise.all([
    prisma.backtestResult.count(),
    prisma.backtestResult.count({ where: { outcome: 'pending' } }),
    prisma.backtestResult.count({ where: { outcome: 'win' } }),
    prisma.backtestResult.count({ where: { outcome: 'loss' } }),
    prisma.backtestResult.count({ where: { outcome: 'expired' } }),
  ])
  return { total, pending, wins, losses, expired }
}
