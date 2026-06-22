export async function register() {
  // Initialize Telegram bot polling on server startup
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const { initTelegramBot } = await import('@/lib/telegram/bot')
    initTelegramBot()
  }
}
