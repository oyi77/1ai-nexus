#!/usr/bin/env node
// -------------------------------------------------------------
// Sniper bot polling daemon: long-polls Telegram getUpdates and
// dispatches /scan, /top, /check commands from the operator's
// review chat. No spending or execution — /scan only screens.
//
// Run: npm run bot:sniper
// Env: SNIPER_TELEGRAM_BOT_TOKEN + SNIPER_REVIEW_CHAT_ID (both required)
// -------------------------------------------------------------

import { startBotLoop } from '@/lib/modules/derived/sniper-bot'

startBotLoop().catch((e) => {
  console.error('[sniper-bot] fatal:', e)
  process.exit(1)
})
