import { initTelegramBot, broadcastAlert } from '@/lib/telegram/bot'
import { startDataRefresher } from '@/lib/data-refresher'


export async function register() {
  // Start background data refresher (pre-fetches all module data)
  startDataRefresher()

  if (process.env.TELEGRAM_BOT_TOKEN) {
    initTelegramBot()

    // Lazy load ioredis only in Node.js runtime (not edge)
    if (typeof process !== 'undefined' && typeof process.version === 'string') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Redis = require('ioredis')

        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
          maxRetriesPerRequest: null,
          retryStrategy(times: number) { return Math.min(times * 200, 5000) },
        })

        redis.subscribe('nexus:memecoin-alerts', (err: Error | null, count: number) => {
          if (err) {
            console.error('[memecoin-alerts] Redis subscribe failed:', err.message)
          } else {
            console.log(`[memecoin-alerts] Subscribed to ${count} channel(s)`)
          }
        })

        redis.on('message', (_channel: string, message: string) => {
          try {
            const alert = JSON.parse(message)
            if (alert.message) {
              broadcastAlert(alert.message)
            }
          } catch (err) {
            console.error('[memecoin-alerts] Failed to process alert:', (err as Error).message)
          }
        })

        redis.on('error', (err: Error) => {
          console.error('[memecoin-alerts] Redis error:', err.message)
        })
      } catch {
        console.warn('[instrumentation] ioredis not available, skipping Redis subscriptions')
      }
    }
  }
}
