// ─────────────────────────────────────────────────────────────
// Meme price observer cron.
//
// Closes the sniper outcome loop independently of the scan pass: reads
// data/sniper-outcomes.json, fetches CURRENT Jupiter prices for every
// still-PENDING signal whose due time has passed, scores via the shared
// `sweepOutcomes`, persists, and sends Telegram close notifications for
// signals that just moved out of PENDING in this run.
//
// Since audit item #9 this cron also logs READ-ONLY multi-horizon outcome
// analytics (1h/4h/24h/7d) and a by-wallet-quality grouping from the
// persisted scan ring buffer. No delivery behaviour depends on it.
//
// Schedule: every 30 minutes
//   */30 * * * * cd /home/openclaw/projects/1ai-tracker && npm run cron:meme-price-observer >> /tmp/meme-price-observer.log 2>&1
//
// Env:
//   MEME_OBSERVER_MAX_SIGNALS — max PENDING signals priced per run (default 25)
//   SNIPER_OUTCOMES_PATH      — override outcome log path (default data/sniper-outcomes.json)
//   SNIPER_LOG_PATH           — override scan-log path (multi-horizon feed)
//   SNIPER_* / HUB_* / TELEGRAM_* — Telegram close-notification channel chain
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { observeSignalOutcomes, buildCloseNotifications } from '@/lib/modules/derived/meme-price-observer'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'
import {
  HORIZON_KEYS,
  groupByWalletQuality,
  projectHorizonSignals,
  summariseHorizons,
  walletQualityFromStrongest,
} from '@/lib/modules/derived/outcome-horizons'
import { loadOutcomeLog } from '@/lib/modules/derived/db-stores'

const LOG_PATH = process.env.SNIPER_LOG_PATH ?? join(process.cwd(), 'data', 'sniper-log.json')

interface SniperLogEntryLike {
  contract?: unknown
  at?: unknown
  market?: { marketCapUsd?: unknown } | null
  smartMoneyStrongest?: unknown
}

/** Scan ring-buffer entries, newest first (missing/corrupt reads as []). */
function readLogEntries(): SniperLogEntryLike[] {
  if (!existsSync(LOG_PATH)) return []
  try {
    const parsed = JSON.parse(readFileSync(LOG_PATH, 'utf8')) as { entries?: SniperLogEntryLike[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

/**
 * Per-contract price history, OLDEST first. The ring buffer stores each
 * evaluation's `market.marketCapUsd` (the same unit-price proxy the outcome
 * pipeline uses), so a delivered signal gets a real multi-horizon shape.
 */
function priceHistoryByContract(): Map<string, Array<{ marketCapUsd: number | null; observedAt: string }>> {
  const byContract = new Map<string, Array<{ marketCapUsd: number | null; observedAt: string }>>()
  for (const entry of readLogEntries()) {
    if (typeof entry.contract !== 'string' || entry.contract.length === 0) continue
    if (typeof entry.at !== 'string') continue
    const bucket = byContract.get(entry.contract) ?? []
    bucket.push({
      marketCapUsd: typeof entry.market?.marketCapUsd === 'number' ? entry.market.marketCapUsd : null,
      observedAt: entry.at,
    })
    byContract.set(entry.contract, bucket)
  }
  for (const bucket of byContract.values()) bucket.reverse()
  return byContract
}

/** Latest (newest-first) strongest wallet label per contract. */
function strongestByContract(entries: SniperLogEntryLike[]): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const entry of entries) {
    if (typeof entry.contract !== 'string' || entry.contract.length === 0) continue
    if (map.has(entry.contract)) continue
    map.set(entry.contract, typeof entry.smartMoneyStrongest === 'string' ? entry.smartMoneyStrongest : null)
  }
  return map
}

/** Compact hit-rate line: `h1=..%`. */
function fmtHorizonPct(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(1)}%`
}

async function main() {
  const before = await loadOutcomeLog()
  const result = await observeSignalOutcomes()
  console.log(
    `[meme-price-observer] checked=${result.checked} closed=${result.closed} updated=${result.updated} errors=${result.errors.length}`,
  )

  const signals = (await loadOutcomeLog()).signals
  const scored = signals.filter((s) => s.verdict === 'TARGET' || s.verdict === 'STOPPED' || s.verdict === 'FLAT')
  if (scored.length > 0) {
    const observations = priceHistoryByContract()
    const byHorizon = summariseHorizons(projectHorizonSignals(signals, observations))
    const horizonLine = HORIZON_KEYS.map((key) => `${key}=${fmtHorizonPct(byHorizon[key].hitRatePct)}`).join(' ')
    console.log(`[meme-price-observer] horizons: ${horizonLine}`)

    const strongest = strongestByContract(readLogEntries())
    const byQuality = groupByWalletQuality(
      scored,
      new Map(signals.map((s) => [s.contract, walletQualityFromStrongest(strongest.get(s.contract))])),
    )
    const qualityLine = Object.entries(byQuality)
      .map(([key, stats]) => `${key}=${fmtHorizonPct(stats.hitRatePct)}`)
      .join(' ')
    console.log(`[meme-price-observer] by-wallet-quality: ${qualityLine}`)
  }

  if (result.updated === 1) {
    const notifications = buildCloseNotifications(before, await loadOutcomeLog())
    for (const text of notifications) {
      const sent = await deliverSniperAlert(text)
      if (!sent) console.error('[meme-price-observer] close notification not delivered (Telegram unconfigured or rejected)')
    }
  }

  for (const e of result.errors) console.error(`[meme-price-observer] error: ${e}`)
  process.exit(0)
}

main().catch((e) => {
  console.error('[meme-price-observer] FATAL:', e)
  process.exit(1)
})
