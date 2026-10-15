// ─────────────────────────────────────────────────────────────
// Meme Sniper — price observer (closes the outcome loop).
//
// sniper-cron.ts registers delivered signals and sweeps them with the SAME
// scan pass's market snapshots. A meme token is rarely still in the
// discovery feed 24h later, so those sweeps never see a fresh observation
// and every signal stays PENDING forever — hitRatePct/avgReturnPct stay
// null and no threshold can be validated.
//
// This module is the independent closer: it reads the outcome log, and for
// every still-PENDING signal fetches the CURRENT Jupiter price for its
// contract, then reuses `sweepOutcomes` so the threshold logic lives in
// exactly one place. The cron `meme-price-observer-cron.ts` runs this on its
// own schedule and sends Telegram close notifications for signals that just
// moved out of PENDING in this run.
//
// Rules inherited from sniper-outcomes:
//   • A signal is only scored once observedAt >= dueAt (delivery + 24h).
//   • No usable price = still PENDING, never a fabricated 0.
//   • The pure scoring in `sweepOutcomes` is reused — this module does NOT
//     duplicate the target/stop/flat thresholds.
//   • `observeSignalOutcomes` never throws; failures become `errors[]`.
// ─────────────────────────────────────────────────────────────

import { setTimeout as sleep } from 'node:timers/promises'
import { escapeHtml } from './meme-sniper'
import { sweepOutcomes, type OutcomeLog, type OutcomeVerdict, type PriceObservation, type SignalOutcome } from './sniper-outcomes'
import { loadOutcomeLog, saveOutcomes } from './db-stores'
import { JUP_PRICE_URL } from './solana-harvest'

/** Delay between Jupiter calls — keeps the public endpoint polite. */
const FETCH_DELAY_MS = 150
/** Jupiter timeout: a hung price fetch must not eat a whole cron tick. */
const FETCH_TIMEOUT_MS = 8_000

export interface ObserveResult {
  /** Number of PENDING signals we actually attempted to price. */
  checked: number
  /** Number of signals that moved out of PENDING in this run. */
  closed: number
  /** 1 when the log was persisted because a verdict changed, else 0. */
  updated: number
  /** Per-contract failures (never thrown). */
  errors: string[]
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Cap of PENDING signals priced per run (env-overridable, default 25). */
function maxSignals(): number {
  const raw = process.env.MEME_OBSERVER_MAX_SIGNALS
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 25
}

/**
 * Pure: the PENDING subset of the log — the only signals worth pricing.
 * By construction a PENDING signal has entryMarketCapUsd !== null and
 * dueAt !== null (see registerDelivered).
 */
export function selectPending(signals: SignalOutcome[]): SignalOutcome[] {
  return signals.filter((s) => s.verdict === 'PENDING')
}

/**
 * Current price for one contract from Jupiter lite-api v3.
 *
 * Jupiter returns a flat per-mint object: `{ "<MINT>": { usdPrice: 1.23 } }`
 * (no nested `data`). `usdPrice` is a PER-TOKEN price, not a market cap.
 * The outcome pipeline stores `marketCapUsd` as a unit-price proxy on the
 * entry side (same approximation solana-harvest makes with
 * `pi = price * inputAmount`), so for consistency this module treats the
 * returned `usdPrice` as the observation's `marketCapUsd` value.
 *
 * Returns null for a missing/NaN/<=0 price (caller records an error, never
 * throws a signal away as a miss). Throws only on transport/HTTP failure.
 */
async function fetchTokenUsd(contract: string): Promise<number | null> {
  const res = await fetch(`${JUP_PRICE_URL}?ids=${encodeURIComponent(contract)}`, {
    headers: { 'User-Agent': 'nexus/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`)
  const json = (await res.json()) as Record<string, { usdPrice?: unknown }>
  const price = json[contract]?.usdPrice
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  return price
}

/**
 * Observe every still-PENDING signal with a fresh Jupiter price and sweep.
 *
 * Reads the log via `readOutcomes`, fetches current prices for up to
 * MEME_OBSERVER_MAX_SIGNALS PENDING signals, scores them with the existing
 * `sweepOutcomes`, and persists via `writeOutcomes` only when a verdict
 * actually changed. Never throws: fetch/persist failures are collected.
 */
export async function observeSignalOutcomes(): Promise<ObserveResult> {
  const errors: string[] = []
  let checked = 0
  let closed = 0
  let updated = 0

  let log: OutcomeLog
  try {
    log = await loadOutcomeLog()
  } catch (e) {
    return { checked: 0, closed: 0, updated: 0, errors: [`loadOutcomeLog failed: ${errorMessage(e)}`] }
  }

  const beforeVerdict = new Map(log.signals.map((s) => [s.contract, s.verdict]))
  const batch = selectPending(log.signals).slice(0, maxSignals())
  const observations: PriceObservation[] = []

  for (let i = 0; i < batch.length; i++) {
    const signal = batch[i]
    checked++
    if (i > 0) await sleep(FETCH_DELAY_MS)
    try {
      const usd = await fetchTokenUsd(signal.contract)
      if (usd === null) {
        errors.push(`${signal.ticker} (${signal.contract}): Jupiter returned no usable price`)
        continue
      }
      observations.push({ contract: signal.contract, marketCapUsd: usd, observedAt: new Date().toISOString() })
    } catch (e) {
      errors.push(`${signal.ticker} (${signal.contract}): ${errorMessage(e)}`)
    }
  }

  if (observations.length > 0) {
    const updatedLog = sweepOutcomes(log, observations)
    closed = updatedLog.signals.filter((s) => {
      return (
        beforeVerdict.get(s.contract) === 'PENDING' &&
        (s.verdict === 'TARGET' || s.verdict === 'STOPPED' || s.verdict === 'FLAT')
      )
    }).length
    const verdictChanged = updatedLog.signals.some((s) => beforeVerdict.get(s.contract) !== s.verdict)
    if (verdictChanged) {
      try {
        await saveOutcomes(updatedLog)
        updated = 1
      } catch (e) {
        errors.push(`saveOutcomes failed: ${errorMessage(e)}`)
      }
    }
  }

  return { checked, closed, updated, errors }
}

// ─── Close notifications (pure) ───────────────────────────────

const VERDICT_LABEL: Record<OutcomeVerdict, string> = {
  PENDING: '⏳ PENDING',
  TARGET: '🎯 TARGET',
  STOPPED: '🛑 STOPPED',
  FLAT: '➖ FLAT',
  UNPRICEABLE: '⚠️ UNPRICEABLE',
}

function fmtPct(r: number | null): string {
  if (r === null) return 'n/a'
  const pct = r * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function fmtUsd(n: number | null): string {
  if (n === null) return 'n/a'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

function buildCloseNotification(s: SignalOutcome): string {
  return [
    `<b>${VERDICT_LABEL[s.verdict]}</b> — ${escapeHtml(s.ticker)} (${escapeHtml(s.tier)})`,
    `Return: ${fmtPct(s.returnPct)}`,
    `Entry: ${fmtUsd(s.entryMarketCapUsd)} → Exit: ${fmtUsd(s.exitMarketCapUsd)}`,
    `<code>${escapeHtml(s.contract)}</code>`,
  ].join('\n')
}

/**
 * Pure: one HTML close notification per signal that just moved out of
 * PENDING in this observation run — i.e. PENDING in `before` and
 * TARGET/STOPPED/FLAT in `after`. Already-closed, still-PENDING and
 * UNPRICEABLE signals are ignored. Each message is far under Telegram's
 * 4096-char limit (a single signal is ~4 short lines).
 */
export function buildCloseNotifications(before: OutcomeLog, after: OutcomeLog): string[] {
  const beforeVerdict = new Map(before.signals.map((s) => [s.contract, s.verdict]))
  return after.signals
    .filter((s) => {
      return (
        beforeVerdict.get(s.contract) === 'PENDING' &&
        (s.verdict === 'TARGET' || s.verdict === 'STOPPED' || s.verdict === 'FLAT')
      )
    })
    .map((s) => buildCloseNotification(s))
    .filter((text) => text.length < 4096)
}
