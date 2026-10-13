#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Smart Money Sync Cron
//
// Runs the full pipeline:
//   1. Sync wallet addresses from the operator's Google Sheet → DB
//   2. Query recent transactions by classified smart money wallets
//   3. Write screening results back to the Google Sheet
//   4. Send Telegram alerts for trades matching:
//      - Token age < 24h
//      - Amount > $1000
//      - Market cap < $1M
//
// Schedule: every 5 minutes via crontab
//   */5 * * * * cd /home/openclaw/projects/1ai-tracker && npm run cron:smart-money-sync >> /tmp/smart-money-sync.log 2>&1
//
// Env:
//   GOOGLE_APPLICATION_CREDENTIALS  → path to service account JSON
//   SNIPER_TELEGRAM_BOT_TOKEN       → bot token for alerts
//   SNIPER_TELEGRAM_CHAT_ID         → chat to send alerts to
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { runSmartMoneySync } from '@/lib/modules/derived/smart-money-sync'

async function main() {
  console.log(`[smart-money-sync-cron] ${new Date().toISOString()} — starting`)
  const result = await runSmartMoneySync()
  console.log(`[smart-money-sync-cron] done:`, JSON.stringify(result))
  process.exit(0)
}

main().catch((err) => {
  console.error('[smart-money-sync-cron] FATAL:', err)
  process.exit(1)
})
