export async function register() {
  // Guard: only run in Node.js runtime, not Edge.
  // Dynamic imports prevent Turbopack from statically bundling Prisma/ioredis
  // chains into the Edge Instrumentation build.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startDataRefresher } = await import('@/lib/data-refresher');
  const { initTelegramBot, broadcastAlert } = await import('@/lib/telegram/bot');

  startDataRefresher()

  if (process.env.TELEGRAM_BOT_TOKEN) {
    initTelegramBot()

    try {
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

