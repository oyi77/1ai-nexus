/**
 * Forward test runner — 10 SOL demo balance, paper trading only.
 *
 * Each run does three things and never places an order:
 *   1. OPEN   — fund a paper position for each new delivered signal that has
 *               not been traded yet, priced at the bar covering its arrival.
 *   2. CLOSE  — mark positions whose horizon has elapsed, using the price at
 *               the horizon boundary (no hindsight target/stop).
 *   3. REPORT — print equity, win rate and the full position ledger, and persist
 *               state so consecutive runs build one continuous track record.
 *
 * Usage:
 *   npm run forward:test                 # one pass
 *   FORWARD_LIMIT=5 npm run forward:test # open at most 5 new positions
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fetchTokenBarSeries, type OhlcvBar } from '@/lib/modules/derived/historical-price'
import { DEMO_HORIZONS, type DeliveredSignal } from '@/lib/modules/derived/signal-backtest'
import { barCovering } from '@/lib/modules/derived/signal-backtest'
import {
  emptyForwardState,
  openForwardPosition,
  closeForwardPosition,
  duePositions,
  summariseForward,
  untradedSignals,
  FORWARD_DEFAULTS,
  type ForwardConfig,
  type ForwardState,
} from '@/lib/modules/derived/forward-test'

const STATE_PATH = resolve(process.cwd(), 'data/forward-test-state.json')
const REPORT_PATH = resolve(process.cwd(), 'data/forward-test-report.json')
const DELIVERY_PATH = resolve(process.cwd(), 'data/sniper-delivery-log.json')

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function loadState(cfg: ForwardConfig): ForwardState {
  if (!existsSync(STATE_PATH)) return emptyForwardState(cfg.startingSol, cfg.solPriceUsd)
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ForwardState
    if (!Array.isArray(parsed.open) || !Array.isArray(parsed.closed)) {
      return emptyForwardState(cfg.startingSol, cfg.solPriceUsd)
    }
    return parsed
  } catch {
    // A corrupt ledger must never silently reset and disguise a losing run.
    console.warn('[forward] state unreadable — starting a fresh ledger')
    return emptyForwardState(cfg.startingSol, cfg.solPriceUsd)
  }
}

function saveState(state: ForwardState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

/** Delivered, timestamped signals from the same log the backtest reads. */
function readDeliveredSignals(): DeliveredSignal[] {
  if (!existsSync(DELIVERY_PATH)) return []
  const raw = JSON.parse(readFileSync(DELIVERY_PATH, 'utf8')) as {
    entries?: Array<{ contract?: string | null; at?: string; ok?: boolean; status?: number }>
  }
  const out: DeliveredSignal[] = []
  for (const e of raw.entries ?? []) {
    if (!e.contract || !e.at) continue
    const delivered = e.ok === true || (typeof e.status === 'number' && e.status >= 200 && e.status < 300)
    if (!delivered) continue
    out.push({ contract: e.contract, at: e.at })
  }
  return out
}

/**
 * Entry price = close of the bar covering the signal timestamp, with retries.
 *
 * Returns `[price, reason]` so the caller can log WHY a signal was skipped:
 * an unpriced entry is a data gap, and "no entry price" alone hides whether it
 * was a rate limit, an HTTP 500, or a pool that does not exist yet.
 */
async function entryPriceAt(
  contract: string,
  atMs: number,
  fetchDelayMs: number,
): Promise<[number | null, string]> {
  let reason = 'empty series'
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, fetchDelayMs * 4 * (attempt - 1)))
    const res = await fetchTokenBarSeries(contract, { timeframe: 'hour', atMs })
    if (res.bars.length === 0) {
      reason = res.source
      // A definitive answer (no pool, no bars yet) will not change on retry.
      if (res.source !== 'geckoterminal:rate-limited') break
      await new Promise((r) => setTimeout(r, 20_000))
      continue
    }
    // Entry price = bar covering the signal (its close is the first price
    // printed AFTER the alert was delivered). Demand close > 0 because a
    // zero-volume inaugural bar must not anchor a trade.
    const entryBar = barCovering(res.bars, atMs)
    if (entryBar && entryBar.close > 0) return [entryBar.close, '']
    reason = 'bar does not cover the signal time'
  }
  return [null, reason]
}

async function main(): Promise<void> {
  const cfg: ForwardConfig = {
    startingSol: numEnv('FORWARD_START_SOL', 10),
    solPriceUsd: numEnv('FORWARD_SOL_PRICE', numEnv('BACKTEST_SOL_PRICE', 150)),
    maxPositionPct: numEnv('FORWARD_MAX_POSITION_PCT', FORWARD_DEFAULTS.maxPositionPct),
    feePct: numEnv('FORWARD_FEE_PCT', FORWARD_DEFAULTS.feePct),
    verdicts: FORWARD_DEFAULTS.verdicts,
  }
  const limit = Math.max(1, Math.trunc(numEnv('FORWARD_LIMIT', 5)))
  const fetchDelayMs = numEnv('FORWARD_FETCH_DELAY_MS', 4200)
  const horizon = (process.env.FORWARD_HORIZON ?? 'h4') as keyof typeof DEMO_HORIZONS
  const nowMs = Date.now()

  const state = loadState(cfg)
  console.log(
    `[forward] demo balance ${cfg.startingSol} SOL = $${(cfg.startingSol * cfg.solPriceUsd).toFixed(2)} ` +
      `@ $${cfg.solPriceUsd}/SOL — virtual, no orders`,
  )
  console.log(`[forward] open=${state.open.length} closed=${state.closed.length} cash=$${state.cashUsd.toFixed(2)}`)

  // ── 1. CLOSE matured positions ─────────────────────────────
  const due = duePositions(state, nowMs)
  for (const [i, pos] of due.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, fetchDelayMs))
    const dueMs = Date.parse(pos.dueAt)
    const bars: OhlcvBar[] = (await fetchTokenBarSeries(pos.contract, { timeframe: 'hour', atMs: dueMs })).bars
    if (bars.length === 0) {
      console.warn(`[forward] ${pos.contract.slice(0, 10)}: no bars at exit — position stays open`)
      continue
    }
    // Exit price = the bar covering the horizon boundary: what the market
    // printed when the holding period ended, not a later, better price.
    const exitBar = barCovering(bars, dueMs)
    const exit = exitBar?.close ?? null
    if (exit === null || !(exit > 0)) {
      console.warn(`[forward] ${pos.contract.slice(0, 10)}: exit unpriceable — position stays open`)
      continue
    }
    const closed = closeForwardPosition(pos, exit, cfg)
    // Return the stake plus its P&L to cash: the position is fully realised.
    state.cashUsd += pos.notionalUsd + closed.pnlUsd
    state.closed.push(closed)
    state.open = state.open.filter((p) => p.contract !== pos.contract)
    console.log(
      `[forward] CLOSED ${pos.contract.slice(0, 10)} ${pos.horizon} ` +
        `${(closed.returnPct * 100).toFixed(2)}% → ${closed.verdict} ($${closed.pnlUsd.toFixed(2)})`,
    )
  }

  // ── 2. OPEN new paper positions ────────────────────────────
  const signals = readDeliveredSignals()
  // Deduplicate by contract: the delivery log repeats a token when it is
  // re-alerted, and two entries for the same mint must not become two
  // positions (or two API round-trips for the same token).
  const uniqueByContract = new Map<string, DeliveredSignal>()
  for (const sig of signals) {
    if (!uniqueByContract.has(sig.contract)) uniqueByContract.set(sig.contract, sig)
  }
  const fresh = untradedSignals([...uniqueByContract.values()], state, limit, 30)
  console.log(`[forward] candidates: ${fresh.length} of ${uniqueByContract.size} unique delivered signal(s)`)

  for (const [i, signal] of fresh.entries()) {
    if (i > 0 || due.length > 0) await new Promise((r) => setTimeout(r, fetchDelayMs))
    const atMs = Date.parse(signal.at)
    const [entry, why] = await entryPriceAt(signal.contract, atMs, fetchDelayMs)
    if (entry === null) {
      console.warn(`[forward] ${signal.contract.slice(0, 10)}: no entry price (${why}) — skipped`)
      continue
    }
    const pos = openForwardPosition(state, signal, entry, horizon, cfg)
    if (!pos) {
      console.warn(`[forward] ${signal.contract.slice(0, 10)}: not opened (duplicate or no cash)`)
      continue
    }
    state.cashUsd -= pos.notionalUsd
    state.open.push(pos)
    state.seenContracts.push(pos.contract)
    console.log(
      `[forward] OPEN   ${pos.contract.slice(0, 10)} ${pos.horizon} ` +
        `$${pos.notionalUsd.toFixed(2)} @ $${entry.toPrecision(6)} due ${pos.dueAt}`,
    )
  }

  // ── 3. REPORT ──────────────────────────────────────────────
  const summary = summariseForward(state)
  console.log('\n── forward test (10 SOL demo, paper only) ──────')
  console.log(
    `equity $${summary.equityUsd.toFixed(2)} = ${(summary.equityUsd / cfg.solPriceUsd).toFixed(4)} SOL ` +
      `(${summary.returnPct >= 0 ? '+' : ''}${(summary.returnPct * 100).toFixed(2)}%)`,
  )
  console.log(`open=${summary.open} closed=${summary.closed} wins=${summary.wins} losses=${summary.losses} flats=${summary.flats}`)
  const pct = (v: number | null): string => (v === null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)
  console.log(
    `winRate=${pct(summary.winRatePct)} avg=${pct(summary.avgReturnPct)} ` +
      `median=${pct(summary.medianReturnPct)} best=${pct(summary.bestReturnPct)} worst=${pct(summary.worstReturnPct)}`,
  )
  if (summary.closed === 0) {
    console.log('no position has reached its horizon yet — rates are n/a, not 0%')
  }

  saveState(state)
  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date(nowMs).toISOString(),
        demo: { startingSol: cfg.startingSol, solPriceUsd: cfg.solPriceUsd, virtual: true },
        summary,
        open: state.open,
        closed: state.closed,
      },
      null,
      2,
    ),
  )
  console.log(`\n[forward] state  → ${STATE_PATH}`)
  console.log(`[forward] report → ${REPORT_PATH}`)
}

main().catch((err) => {
  console.error('[forward] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
