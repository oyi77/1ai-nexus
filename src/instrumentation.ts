import { initTelegramBot, broadcastAlert } from '@/lib/telegram/bot'
import Redis from 'ioredis'

export async function register() {
  // Initialize Telegram bot polling on server startup
  if (process.env.TELEGRAM_BOT_TOKEN) {
    initTelegramBot()

    // Subscribe to memecoin alerts from the WS server via Redis Pub/Sub
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      retryStrategy(times) { return Math.min(times * 200, 5000) },
    })

    redis.subscribe('nexus:memecoin-alerts', (err, count) => {
      if (err) {
        console.error('[memecoin-alerts] Redis subscribe failed:', err.message)
      } else {
        console.log(`[memecoin-alerts] Subscribed to ${count} channel(s)`)
      }
    })

    redis.on('message', (_channel, message) => {
      try {
        const alert = JSON.parse(message)
        if (alert.message) {
          broadcastAlert(alert.message)
        }
      } catch (err) {
        console.error('[memecoin-alerts] Failed to process alert:', (err as Error).message)
      }
    })

    redis.on('error', (err) => {
      console.error('[memecoin-alerts] Redis error:', err.message)
    })
  }
}
