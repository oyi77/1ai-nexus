/**
 * Backfill script: re-evaluate all BacktestResult rows that were recorded as
 * hitTarget='tp1' under the old (buggy) logic.
 *
 * Old logic: iterate tp1→tp2→tp3, return on first hit → always tp1.
 * New logic: iterate tp3→tp2→tp1, return the FARTHEST target reached.
 *
 * Run: npx ts-node --esm scripts/backfill-tp-targets.ts
 * or:  npx tsx scripts/backfill-tp-targets.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Candle = { time: number; high: number; low: number; close: number }

async function fetchCandles(symbol: string, startTime: number, endTime: number): Promise<Candle[]> {
  const all: Candle[] = []
  let cursor = startTime

  while (cursor < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1h&startTime=${cursor}&endTime=${endTime}&limit=1000`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) break

    const data = (await res.json()) as Array<[number, string, string, string, string]>
    if (data.length === 0) break

    for (const k of data) {
      all.push({ time: k[0], high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) })
    }

    cursor = data[data.length - 1][0] + 1
    if (data.length < 1000) break
  }

  return all
}

function checkFarthestTarget(
  candles: Candle[],
  direction: string,
  entryPrice: number,
  tp1: number,
  tp2: number | null,
  tp3: number | null,
  sl: number,
  signalTime: number,
): { hitTarget: string; exitPrice: number } | null {
  const isBullish = direction === 'bullish'

  // Build targets closest→farthest (tp1→tp2→tp3); reverse-iterate to find farthest
  const targets: { price: number; name: string }[] = [{ price: tp1, name: 'tp1' }]
  if (tp2 !== null) targets.push({ price: tp2, name: 'tp2' })
  if (tp3 !== null) targets.push({ price: tp3, name: 'tp3' })

  for (const candle of candles) {
    if (candle.time <= signalTime) continue

    // SL check first (conservative)
    if (isBullish && candle.low <= sl) return null   // still a loss, no change needed
    if (!isBullish && candle.high >= sl) return null  // still a loss

    // Farthest TP reached in this candle
    if (isBullish) {
      for (let i = targets.length - 1; i >= 0; i--) {
        if (candle.high >= targets[i].price) {
          return { hitTarget: targets[i].name, exitPrice: targets[i].price }
        }
      }
    } else {
      for (let i = targets.length - 1; i >= 0; i--) {
        if (candle.low <= targets[i].price) {
          return { hitTarget: targets[i].name, exitPrice: targets[i].price }
        }
      }
    }
  }

  return null // expired — leave as-is
}

async function main() {
  const rows = await prisma.backtestResult.findMany({
    where: { hitTarget: 'tp1', outcome: 'win' },
    select: {
      id: true,
      symbol: true,
      direction: true,
      entryPrice: true,
      tp1: true,
      tp2: true,
      tp3: true,
      sl: true,
      backtestDate: true,
    },
  })

  console.log(`Found ${rows.length} tp1-win records to re-evaluate`)

  // Group by symbol to batch-fetch candles
  const bySymbol = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = bySymbol.get(r.symbol) ?? []
    list.push(r)
    bySymbol.set(r.symbol, list)
  }

  let upgraded = 0
  let unchanged = 0
  let skipped = 0
  const breakdown: Record<string, number> = { tp1: 0, tp2: 0, tp3: 0 }

  for (const [symbol, signals] of bySymbol) {
    const earliest = Math.min(...signals.map(s => s.backtestDate.getTime()))
    const now = Date.now()

    console.log(`  Fetching candles for ${symbol} (${signals.length} signals)…`)
    const candles = await fetchCandles(symbol, earliest, now)

    if (candles.length === 0) {
      console.log(`    No candles for ${symbol} — skipping`)
      skipped += signals.length
      continue
    }

    for (const signal of signals) {
      if (!signal.tp1 || !signal.sl) { skipped++; continue }

      const result = checkFarthestTarget(
        candles,
        signal.direction,
        signal.entryPrice,
        signal.tp1,
        signal.tp2,
        signal.tp3,
        signal.sl,
        signal.backtestDate.getTime(),
      )

      if (!result || result.hitTarget === 'tp1') {
        breakdown.tp1++
        unchanged++
        continue
      }

      // Re-compute pnlPercent with new exitPrice
      const pnlPercent = signal.direction === 'bullish'
        ? ((result.exitPrice - signal.entryPrice) / signal.entryPrice) * 100
        : ((signal.entryPrice - result.exitPrice) / signal.entryPrice) * 100

      await prisma.backtestResult.update({
        where: { id: signal.id },
        data: {
          hitTarget: result.hitTarget,
          exitPrice: result.exitPrice,
          pnlPercent,
        },
      })

      breakdown[result.hitTarget] = (breakdown[result.hitTarget] ?? 0) + 1
      upgraded++
    }
  }

  console.log('\n─── Backfill complete ───────────────────────────────')
  console.log(`  Records re-evaluated : ${rows.length}`)
  console.log(`  Upgraded (tp2/tp3)   : ${upgraded}`)
  console.log(`  Unchanged (tp1)      : ${unchanged}`)
  console.log(`  Skipped (no candles) : ${skipped}`)
  console.log(`  Breakdown            : tp1=${breakdown.tp1} tp2=${breakdown.tp2 ?? 0} tp3=${breakdown.tp3 ?? 0}`)
  console.log('─────────────────────────────────────────────────────')

  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
