// ─────────────────────────────────────────────────────────────
// Meme price observer cron.
//
// Closes the sniper outcome loop independently of the scan pass: reads
// data/sniper-outcomes.json, fetches CURRENT Jupiter prices for every
// still-PENDING signal whose due time has passed, scores via the shared
// `sweepOutcomes`, persists, and sends Telegram close notifications for
// signals that just moved out of PENDING in this run.
//
// Schedule: every 30 minutes
//   */30 * * * * cd /home/openclaw/projects/1ai-tracker && npm run cron:meme-price-observer >> /tmp/meme-price-observer.log 2>&1
//
// Env:
//   MEME_OBSERVER_MAX_SIGNALS — max PENDING signals priced per run (default 25)
//   SNIPER_OUTCOMES_PATH      — override outcome log path (default data/sniper-outcomes.json)
//   SNIPER_* / HUB_* / TELEGRAM_* — Telegram close-notification channel chain
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { observeSignalOutcomes, buildCloseNotifications } from '@/lib/modules/derived/meme-price-observer'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'
import { readOutcomes } from '@/lib/modules/derived/sniper-outcomes'

async function main() {
  const before = readOutcomes()
  const result = await observeSignalOutcomes()
  console.log(
    `[meme-price-observer] checked=${result.checked} closed=${result.closed} updated=${result.updated} errors=${result.errors.length}`,
  )

  if (result.updated === 1) {
    const notifications = buildCloseNotifications(before, readOutcomes())
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
