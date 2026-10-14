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
import { readOutcomes } from '@/lib/modules/derived/sniper-outcomes'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'

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

async function main() {
  const signals = readOutcomes().signals
  const positions = buildPaperPositions(signals, notionalUsd())
  const summary = summarisePaperPositions(positions)

  console.log(
    `[paper-buy] positions=${positions.length} closed=${summary.closedPositions} ` +
      `wins=${summary.wins} losses=${summary.losses} pnl=$${summary.totalPnlUsd.toFixed(2)} ` +
      `winRate=${summary.winRatePct === null ? 'n/a' : `${summary.winRatePct.toFixed(1)}%`}`,
  )

  if (sendSummary()) {
    const chat = reviewChatId()
    if (chat) {
      const text = renderPaperSummary(summary)
      const sent = await deliverSniperAlert(text, chat)
      console.log(`[paper-buy] summary ${sent ? 'sent' : 'rejected/unconfigured'} to review chat`)
    } else {
      console.log('[paper-buy] summary skipped (no review chat configured)')
    }
  }

  process.exit(0)
}

main().catch((e) => {
  // Analysis cron: never fails the pipeline.
  console.error('[paper-buy] error (non-fatal):', e)
  process.exit(0)
})
