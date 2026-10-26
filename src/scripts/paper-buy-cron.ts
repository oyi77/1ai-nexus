// ─────────────────────────────────────────────────────────────
// Paper-buy cron — shadow PnL over the sniper outcome log.
//
// Reads data/sniper-outcomes.json, simulates a fixed-notional buy at every
// delivered signal's entry market cap, and reports the paper portfolio PnL
// to the operator's review chat. NO on-chain execution, NO fabricated
// prices: every PnL figure comes from a forward observation the outcome
// pipeline already recorded.
//
// KNOWN LIMITATION (stated here and in .env.example): the outcome log keeps
// ONE exit price per signal (its own horizon — 24h by default), so the sim
// scores the 24h (logged-horizon) verdict only. The per-horizon h1/h4/d7
// breakdown is FUTURE work once the price observer persists per-horizon
// observations; this cron refuses to invent them.
//
// Schedule: after the observer closes outcomes, e.g.
//   15 */2 * * * cd /home/openclaw/projects/1ai-tracker && npm run cron:paper-buy >> /tmp/paper-buy.log 2>&1
//
// Env:
//   PAPER_NOTIONAL_USD   — notional staked per paper position (default 100)
//   PAPER_SEND_SUMMARY   — "true" (default) pushes the summary to the
//                          review chat (SNIPER_REVIEW_CHAT_ID chain — the
//                          operator DM, never the public sale channel)
//   SNIPER_OUTCOMES_PATH — override outcome log path
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'

import {
  buildPaperPositions,
  renderPaperSummary,
  summarisePaperPositions,
} from '@/lib/modules/derived/paper-buy'
import { loadOutcomeLog } from '@/lib/modules/derived/db-stores'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'
import type { SignalOutcome } from '@/lib/modules/derived/sniper-outcomes'
import { pathToFileURL } from 'node:url'

const DEFAULT_NOTIONAL_USD = 100

/** Operator DM chain — same fallback ladder as sniper-cron's review alerts;
 * deliberately does NOT fall back to the sale channel. */
function reviewChatId(): string {
  return (
    process.env.SNIPER_REVIEW_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  )
}

function notionalUsd(): number {
  const parsed = Number.parseFloat(process.env.PAPER_NOTIONAL_USD ?? '')
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NOTIONAL_USD
}

function sendSummary(): boolean {
  return (process.env.PAPER_SEND_SUMMARY ?? 'true') === 'true'
}

/** Injected I/O so the runner is testable without env, network or files. */
export interface PaperCronDeps {
  loadSignals: () => Promise<SignalOutcome[]>
  deliver: (text: string, chatId: string) => Promise<boolean>
  reviewChatId: () => string
  notionalUsd: () => number
  sendSummary: () => boolean
}

const DEFAULT_DEPS: PaperCronDeps = {
  loadSignals: async () => (await loadOutcomeLog()).signals,
  deliver: deliverSniperAlert,
  reviewChatId,
  notionalUsd,
  sendSummary,
}

/** One paper-buy pass. An empty paper book has nothing to report, so it
 * never reaches the review chat — a periodic "positions=0" push is noise.
 * Returns the delivered text, or null when nothing was sent. */
export async function runPaperBuyCron(deps: PaperCronDeps = DEFAULT_DEPS): Promise<string | null> {
  const signals = await deps.loadSignals()
  const positions = buildPaperPositions(signals, deps.notionalUsd())
  const summary = summarisePaperPositions(positions)

  console.log(
    `[paper-buy] positions=${positions.length} closed=${summary.closedPositions} ` +
      `wins=${summary.wins} losses=${summary.losses} pnl=$${summary.totalPnlUsd.toFixed(2)} ` +
      `winRate=${summary.winRatePct === null ? 'n/a' : `${summary.winRatePct.toFixed(1)}%`}`,
  )

  if (positions.length === 0) {
    console.log('[paper-buy] summary suppressed (empty paper book — no positions to report)')
    return null
  }

  if (!deps.sendSummary()) return null
  const chat = deps.reviewChatId()
  if (!chat) {
    console.log('[paper-buy] summary skipped (no review chat configured)')
    return null
  }
  const text = renderPaperSummary(summary)
  const sent = await deps.deliver(text, chat)
  console.log(`[paper-buy] summary ${sent ? 'sent' : 'rejected/unconfigured'} to review chat`)
  return sent ? text : null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPaperBuyCron().then(
    () => undefined,
    (e) => {
      // Analysis cron: never fails the pipeline.
      console.error('[paper-buy] error (non-fatal):', e)
      process.exit(0)
    },
  )
}
