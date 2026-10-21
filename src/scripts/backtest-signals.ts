#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Signal backtest against REAL historical prices + demo portfolio.
//
// Data source: data/sniper-delivery-log.json (what we actually told the
// operator, with timestamps). Prices: GeckoTerminal OHLCV, the same source
// the rest of the repo trusts for historical USD.
//
// This is a DEMO: the 10 SOL balance is virtual and no order is ever placed.
//
//   npm run backtest:signals                # all horizons, 10 SOL demo
//   BACKTEST_LIMIT=50 npm run backtest:signals
//   BACKTEST_SOL=10 BACKTEST_SOL_PRICE=150 npm run backtest:signals
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { fetchTokenBarSeries } from '@/lib/modules/derived/historical-price'
import type { OhlcvBar } from '@/lib/modules/derived/historical-price'
import {
  DEMO_BACKTEST_DEFAULTS,
  DEMO_HORIZON_KEYS,
  classifyTrade,
  priceTrade,
  runDemoPortfolio,
  summariseDemoBacktest,
  type DeliveredSignal,
  type DemoTrade,
} from '@/lib/modules/derived/signal-backtest'

const DELIVERY_LOG = join(process.cwd(), 'data', 'sniper-delivery-log.json')
const REPORT_PATH = join(process.cwd(), 'data', 'signal-backtest-report.json')

function numEnv(name: string, fallback: number): number {
  const parsed = Number.parseFloat(process.env[name] ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

interface DeliveryEntry {
  contract?: string
  at?: string
  ok?: boolean
  status?: number | null
}

/**
 * Read delivered signals. Only rows that were actually delivered (`ok` truthy
 * or HTTP 2xx) and carry both a contract and a timestamp can be backtested —
 * anything else would be inventing a signal that never reached anyone.
 */
function readDeliveredSignals(): { signals: DeliveredSignal[]; skipped: number } {
  if (!existsSync(DELIVERY_LOG)) return { signals: [], skipped: 0 }
  const raw = JSON.parse(readFileSync(DELIVERY_LOG, 'utf8')) as { entries?: DeliveryEntry[] }
  const entries = Array.isArray(raw.entries) ? raw.entries : []

  const seen = new Set<string>()
  const signals: DeliveredSignal[] = []
  let skipped = 0

  for (const entry of entries) {
    const contract = entry.contract?.trim()
    const delivered = entry.ok === true || (typeof entry.status === 'number' && entry.status >= 200 && entry.status < 300)
    if (!contract || !entry.at || !delivered || !Number.isFinite(Date.parse(entry.at))) {
      skipped += 1
      continue
    }
    // One position per contract per delivery time.
    const key = `${contract}@${entry.at}`
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    signals.push({ contract, at: entry.at })
  }
  return { signals, skipped }
}

async function main(): Promise<void> {
  const nowMs = Date.now()
  const limit = Math.max(1, Math.trunc(numEnv('BACKTEST_LIMIT', 60)))
  const startingSol = numEnv('BACKTEST_SOL', 10)
  const solPriceUsd = numEnv('BACKTEST_SOL_PRICE', 150)
  const maxPositionPct = numEnv('BACKTEST_MAX_POSITION_PCT', 0.1)
  const feePct = numEnv('BACKTEST_FEE_PCT', 0.005)
  // Each signal costs TWO GeckoTerminal calls (pool resolve + OHLCV) and the
  // keyless tier allows ~30/min. 4.2s/signal keeps us near 28/min; anything
  // faster just converts the run into a 429 storm and a biased sample.
  const fetchDelayMs = numEnv('BACKTEST_FETCH_DELAY_MS', 4200)
  // After a 429 we are the problem: cool down hard instead of burning attempts.
  const rateLimitCooldownMs = numEnv('BACKTEST_429_COOLDOWN_MS', 20_000)

  const { signals, skipped } = readDeliveredSignals()
  console.log(
    `[backtest] delivered signals: ${signals.length} usable, ${skipped} skipped (no contract/time/not delivered)`,
  )
  if (signals.length === 0) {
    console.log('[backtest] nothing to evaluate — the delivery log has no timestamped signals')
    return
  }

  // Evaluate the most recent signals first: their horizons have elapsed and
  // their tokens are the ones the strategy is actually selecting today.
  const selected = [...signals].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit)
  console.log(`[backtest] evaluating ${selected.length} signal(s), horizons: ${DEMO_HORIZON_KEYS.join(', ')}`)

  const trades: DemoTrade[] = []
  let priceFailures = 0

  for (const [index, signal] of selected.entries()) {
    if (index > 0) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, fetchDelayMs)
      await promise
    }
    let bars: OhlcvBar[] = []
    let attempts = 0
    let lastError = ''
    while (attempts < 3) {
      if (attempts > 0) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, fetchDelayMs * 4 * attempts)
        await promise
      }
      attempts += 1
      try {
        const res = await fetchTokenBarSeries(signal.contract, { timeframe: 'hour' })
        if (res.bars.length > 0) {
          bars = res.bars
          break
        }
        if (res.source === 'geckoterminal:rate-limited') {
          lastError = 'rate limited'
          const { promise, resolve } = Promise.withResolvers<void>()
          setTimeout(resolve, rateLimitCooldownMs)
          await promise
          continue
        }
        if (res.source === 'error') {
          // Transport failure (timeout/HTTP/DNS). Retry with backoff, and name
          // what we know so a bare 'error' never hides the cause.
          lastError = `error (bars=0, pool=${res.poolAddress ?? 'none'})`
          continue
        }
        // A definitive answer from the API (pool not found, no bars) is NOT a
        // network failure - retrying would just burn the rate limit.
        lastError = res.source
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
    if (bars.length === 0) {
      priceFailures += 1
      // A pool with few bars is a young token, not a broken fetch — say which.
      const why = lastError.includes('pool-not-found')
        ? 'no GeckoTerminal pool'
        : lastError || 'empty series'
      console.warn(`[backtest] ${signal.contract.slice(0, 10)}: ${why} (${attempts} attempt(s))`)
    }

    for (const horizon of DEMO_HORIZON_KEYS) {
      const trade = priceTrade(signal, horizon, bars, nowMs)
      trades.push(classifyTrade(trade, DEMO_BACKTEST_DEFAULTS))
    }
  }

  const summary = summariseDemoBacktest(trades)
  const portfolio = runDemoPortfolio(trades, {
    startingSol,
    solPriceUsd,
    maxPositionPct,
    feePct,
  })

  // Per-horizon breakdown: which holding period actually paid.
  const byHorizon = Object.fromEntries(
    DEMO_HORIZON_KEYS.map((key) => [key, summariseDemoBacktest(trades.filter((t) => t.horizon === key))]),
  )

  const report = {
    generatedAt: new Date().toISOString(),
    source: DELIVERY_LOG,
    requested: selected.length,
    priceFailures,
    config: { ...DEMO_BACKTEST_DEFAULTS, startingSol, solPriceUsd, maxPositionPct, feePct },
    summary,
    byHorizon,
    portfolio,
    trades,
  }

  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const fmt = (v: number | null, suffix = '%') =>
    v === null || !Number.isFinite(v) ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}${suffix}`

  console.log('')
  console.log('── backtest summary ─────────────────────────────')
  console.log(`priced=${summary.priced} unpriceable=${summary.unpriceable} targets=${summary.targets} stops=${summary.stops} flats=${summary.flats}`)
  console.log(`winRate=${fmt(summary.winRatePct)} avg=${fmt(summary.avgReturnPct)} median=${fmt(summary.medianReturnPct)}`)
  console.log(`best=${fmt(summary.bestReturnPct)} worst=${fmt(summary.worstReturnPct)}`)
  console.log('')
  for (const key of DEMO_HORIZON_KEYS) {
    const h = byHorizon[key]
    console.log(`  ${key.padEnd(4)} priced=${String(h.priced).padStart(3)} win=${fmt(h.winRatePct)} avg=${fmt(h.avgReturnPct)} median=${fmt(h.medianReturnPct)}`)
  }
  console.log('')
  console.log('── demo portfolio (virtual funds, no orders) ────')
  console.log(`start ${startingSol} SOL = $${portfolio.startingUsd.toFixed(2)} @ $${solPriceUsd}/SOL`)
  console.log(`end   ${portfolio.endingSol.toFixed(4)} SOL = $${portfolio.endingUsd.toFixed(2)}`)
  console.log(`return ${fmt(portfolio.returnPct)} over ${portfolio.positions.length} position(s)`)
  console.log(`skipped: unpriceable=${portfolio.skippedUnpriceable} no-capital=${portfolio.skippedNoCapital}`)
  console.log('')
  console.log(`[backtest] wrote ${REPORT_PATH}`)
}

main()
  .catch((err) => {
    console.error('[backtest] FATAL:', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
