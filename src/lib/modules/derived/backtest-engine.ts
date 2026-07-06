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

// Partial TP exit sizes — industry standard 50/25/25
const TP_SIZES: Record<string, number> = { tp1: 0.5, tp2: 0.25, tp3: 0.25 }

interface PartialExit {
  target: string   // 'tp1' | 'tp2' | 'tp3'
  price: number
  size: number     // fraction of position (0–1)
}

interface CheckResult {
  outcome: 'win' | 'loss' | 'expired'
  exits: PartialExit[]         // all partial exits executed
  finalSl: number              // trailing SL at close
  hitTarget: string | null     // farthest TP hit (or 'sl')
  durationHours: number | null
  exitPrice: number | null     // blended avg exit price for DB compat
}

// Simulate partial TP execution with trailing SL.
//
// Rules:
//   • Before TP1: SL stays at original signal.sl
//   • After TP1 hit: SL moves to entry (breakeven)
//   • After TP2 hit: SL moves to TP1 price
//   • TP3 hit: full position closed
//   • SL check runs BEFORE TP check each candle (conservative)
//
// Returns all partial exits so caller can compute blended PnL.
function checkOutcome(
  candles: Array<{ time: number; high: number; low: number; close: number }>,
  signal: BacktestSignal
): CheckResult {
  const empty = (outcome: 'expired'): CheckResult => ({
    outcome, exits: [], finalSl: signal.sl ?? 0,
    hitTarget: null, durationHours: null, exitPrice: null,
  })

  if (!signal.entry || !signal.sl) return empty('expired')

  const isBullish = signal.direction === 'bullish'
  const entryTime = signal.timestamp

  const targets = [
    { price: signal.tp1, name: 'tp1' },
    { price: signal.tp2, name: 'tp2' },
    { price: signal.tp3, name: 'tp3' },
  ].filter((t): t is { price: number; name: string } =>
    t.price !== null && t.price !== undefined
  )

  if (targets.length === 0) return empty('expired')

  // Mutable state across candles
  let currentSl = signal.sl
  let remainingSize = 1.0
  const exits: PartialExit[] = []
  const hitTargetSet = new Set<string>()

  for (const candle of candles) {
    if (candle.time <= entryTime) continue

    const durationHours = (candle.time - entryTime) / 3_600_000

    // ── SL check (before TP — conservative) ──────────────────
    const slHit = isBullish
      ? candle.low <= currentSl
      : candle.high >= currentSl

    if (slHit) {
      if (remainingSize > 0) {
        exits.push({ target: 'sl', price: currentSl, size: remainingSize })
      }
      const farthest = [...hitTargetSet].pop() ?? null
      const outcome = exits.some(e => e.target !== 'sl') ? 'win' : 'loss'
      return {
        outcome,
        exits,
        finalSl: currentSl,
        hitTarget: farthest ?? 'sl',
        durationHours,
        exitPrice: blendedExitPrice(exits),
      }
    }

    // ── TP checks — advance through unmet targets ─────────────
    for (const t of targets) {
      if (hitTargetSet.has(t.name)) continue

      const reached = isBullish
        ? candle.high >= t.price
        : candle.low <= t.price

      if (!reached) break // targets are ordered; if this one not hit, next won't be either

      const size = TP_SIZES[t.name] ?? 0
      exits.push({ target: t.name, price: t.price, size })
      remainingSize -= size
      hitTargetSet.add(t.name)

      // Advance trailing SL
      if (t.name === 'tp1') currentSl = signal.entry         // breakeven
      if (t.name === 'tp2') currentSl = signal.tp1 ?? signal.entry // lock tp1

      if (remainingSize <= 0) {
        return {
          outcome: 'win',
          exits,
          finalSl: currentSl,
          hitTarget: t.name,
          durationHours,
          exitPrice: blendedExitPrice(exits),
        }
      }
    }
  }

  // Time ran out — expire remaining position at last close
  const lastCandle = candles[candles.length - 1]
  if (!lastCandle) return empty('expired')

  if (remainingSize > 0) {
    exits.push({ target: 'expired', price: lastCandle.close, size: remainingSize })
  }

  // If any TPs were hit before expiry → still a win
  const tpHits = exits.filter(e => e.target.startsWith('tp'))
  const outcome = tpHits.length > 0 ? 'win' : 'expired'
  const farthest = [...hitTargetSet].pop() ?? null
  return {
    outcome,
    exits,
    finalSl: currentSl,
    hitTarget: farthest,
    durationHours: (lastCandle.time - entryTime) / 3_600_000,
    exitPrice: blendedExitPrice(exits),
  }
}

// Weighted average exit price across all partial exits
function blendedExitPrice(exits: PartialExit[]): number | null {
  const totalSize = exits.reduce((s, e) => s + e.size, 0)
  if (totalSize === 0) return null
  return exits.reduce((s, e) => s + e.price * e.size, 0) / totalSize
}

// Compute blended PnL% given partial exits and entry
function calcBlendedPnl(
  exits: PartialExit[],
  entry: number,
  direction: 'bullish' | 'bearish'
): number {
  return exits.reduce((total, e) => {
    const legPnl = direction === 'bullish'
      ? ((e.price - entry) / entry) * 100
      : ((entry - e.price) / entry) * 100
    return total + legPnl * e.size
  }, 0)
}

// Store a signal for future backtesting — idempotent; same signal_id is a no-op
export async function storeSignal(signal: BacktestSignal): Promise<void> {
  const id = `signal-${signal.id}`
  await prisma.backtestResult.upsert({
    where: { id },
    update: {}, // already stored — do nothing
    create: {
      id,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entry,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      sl: signal.sl,
      outcome: 'pending',
      exitPrice: null,
      pnlPercent: null,
      hitTarget: null,
      durationHours: null,
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
  const clampedDays = Math.min(90, Math.max(7, periodDays))
  const now = Date.now()
  const startTime = now - clampedDays * 24 * 60 * 60 * 1000
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

  if (storedSignals.length === 0) return { results: [], stats: emptyStats() }

  const bySymbol = new Map<string, typeof storedSignals>()
  for (const s of storedSignals) {
    const existing = bySymbol.get(s.symbol) ?? []
    existing.push(s)
    bySymbol.set(s.symbol, existing)
  }

  const results: BacktestResult[] = []

  for (const [symbol, signals] of bySymbol) {
    const earliest = Math.min(...signals.map(s => s.backtestDate.getTime()))
    const candles = await fetchHistoricalPrices(symbol, earliest, now)
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

      const { outcome, exits, hitTarget, durationHours, exitPrice } = checkOutcome(candles, backtestSignal)

      const pnlPercent = exits.length > 0 && signal.entryPrice
        ? calcBlendedPnl(exits, signal.entryPrice, backtestSignal.direction)
        : null

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

  // Batch update DB
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

// Valid period durations in milliseconds
const VALID_PERIOD_MS: Record<string, number> = {
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

// Check and update expired signal outcomes (run hourly via cron)
export async function checkExpiredSignals(): Promise<{ checked: number; updated: number; wins: number; losses: number; expired: number; notTriggered: number }> {
  // Get all pending signals
  const pending = await prisma.backtestResult.findMany({
    where: { outcome: 'pending' },
    take: 500,
  })

  if (pending.length === 0) return { checked: 0, updated: 0, wins: 0, losses: 0, expired: 0, notTriggered: 0 }

  // Group by symbol for efficient price fetching
  const bySymbol = new Map<string, typeof pending>()
  for (const s of pending) {
    const existing = bySymbol.get(s.symbol) ?? []
    existing.push(s)
    bySymbol.set(s.symbol, existing)
  }

  let wins = 0, losses = 0, expired = 0, notTriggered = 0, updated = 0
  const now = Date.now()

  for (const [symbol, signals] of bySymbol) {
    const earliest = Math.min(...signals.map(s => s.backtestDate.getTime()))
    const candles = await fetchHistoricalPrices(symbol, earliest, now)
    if (candles.length === 0) continue

    for (const signal of signals) {
      const signalTime = signal.backtestDate.getTime()
      const ageHours = (now - signalTime) / (1000 * 60 * 60)

      // Determine valid period from source
      const validPeriod = signal.source === 'funding-rate' ? '24h' :
                          signal.source === 'whale-alert' ? '24h' :
                          signal.source === 'fear-greed' ? '4h' : '24h'
      const validMs = VALID_PERIOD_MS[validPeriod] ?? VALID_PERIOD_MS['24h']
      const expiryTime = signalTime + validMs

      // Check if entry was hit
      const entryHit = candles.some(c => {
        if (signal.direction === 'bullish') {
          return c.low <= signal.entryPrice && c.time > signalTime
        } else {
          return c.high >= signal.entryPrice && c.time > signalTime
        }
      })

      if (!entryHit && now > expiryTime) {
        // Entry never hit within valid period
        await prisma.backtestResult.update({
          where: { id: signal.id },
          data: {
            outcome: 'not_triggered',
            exitPrice: null,
            pnlPercent: 0,
            hitTarget: null,
            durationHours: ageHours,
          },
        })
        notTriggered++
        updated++
        continue
      }

      if (!entryHit) {
        // Entry not hit yet, still within valid period
        continue
      }

      // Entry was hit - check TP/SL
      const backtestSignal: BacktestSignal = {
        id: signal.signalId ?? signal.id,
        symbol: signal.symbol,
        direction: signal.direction as 'bullish' | 'bearish',
        entry: signal.entryPrice,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        sl: signal.sl,
        timestamp: signalTime,
        source: signal.source,
      }

      const { outcome, exits, exitPrice, hitTarget, durationHours } = checkOutcome(candles, backtestSignal)

      if (outcome === 'win' || outcome === 'loss') {
        const pnlPercent = exits.length > 0
          ? calcBlendedPnl(exits, signal.entryPrice, backtestSignal.direction)
          : exitPrice !== null
            ? backtestSignal.direction === 'bullish'
              ? ((exitPrice - signal.entryPrice) / signal.entryPrice) * 100
              : ((signal.entryPrice - exitPrice) / signal.entryPrice) * 100
            : 0

        await prisma.backtestResult.update({
          where: { id: signal.id },
          data: { outcome, exitPrice, pnlPercent, hitTarget, durationHours },
        })
        if (outcome === 'win') wins++
        else losses++
        updated++

      } else if (now > expiryTime) {
        // Entry hit but TP/SL not hit within valid period
        // Determine outcome based on PnL at expiry
        const lastCandle = candles[candles.length - 1]
        const exitP = lastCandle?.close ?? signal.entryPrice
        const pnlPercent = backtestSignal.direction === 'bullish'
          ? ((exitP - signal.entryPrice) / signal.entryPrice) * 100
          : ((signal.entryPrice - exitP) / signal.entryPrice) * 100

        const finalOutcome = pnlPercent >= 0 ? 'win' : 'loss'
        if (finalOutcome === 'win') wins++
        else losses++

        await prisma.backtestResult.update({
          where: { id: signal.id },
          data: {
            outcome: finalOutcome,
            exitPrice: exitP,
            pnlPercent,
            hitTarget: null,
            durationHours: (now - signalTime) / (1000 * 60 * 60),
          },
        })
        updated++
      }
    }
  }

  return { checked: pending.length, updated, wins, losses, expired, notTriggered }
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
  notTriggered: number
}> {
  const [total, pending, wins, losses, expired, notTriggered] = await Promise.all([
    prisma.backtestResult.count(),
    prisma.backtestResult.count({ where: { outcome: 'pending' } }),
    prisma.backtestResult.count({ where: { outcome: 'win' } }),
    prisma.backtestResult.count({ where: { outcome: 'loss' } }),
    prisma.backtestResult.count({ where: { outcome: 'expired' } }),
    prisma.backtestResult.count({ where: { outcome: 'not_triggered' } }),
  ])
  return { total, pending, wins, losses, expired, notTriggered }
}
