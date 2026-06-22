import { NextResponse } from 'next/server'
import { initTelegramBot, getBotStatus, getRegisteredChats } from '@/lib/telegram/bot'

// Initialize bot on first request (server-side only)
let initialized = false
function ensureBotStarted() {
  if (!initialized && process.env.TELEGRAM_BOT_TOKEN) {
    initialized = true
    initTelegramBot()
  }
}

export async function GET() {
  ensureBotStarted()
  const status = getBotStatus()
  return NextResponse.json({
    data: {
      ...status,
      chats: status.enabled ? getRegisteredChats().length : 0,
    },
    meta: null,
    error: null,
  }, {
    headers: { 'Cache-Control': 'public, max-age=10' },
  })
}
