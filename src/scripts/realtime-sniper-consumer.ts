#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Realtime sniper consumer.
//
// Subscribes to the `nexus:realtime-sniper` Redis pub/sub channel — fed by
// ws-server/memecoins.ts (publish side, inside scheduleTelegramAlert) — and
// pushes every event through the REAL sniper pipeline via
// onRealtimeToken (audit fan-out → evaluateSniper ebook profiles →
// classifySignalTier → policy-gated Telegram delivery).
//
// Why a separate process: the bridge module graph (sniper-scan → audit
// providers → prisma) is far too heavy to load into the ws-server CommonJS
// process, so the hype scorer publishes a small flat JSON event and this
// consumer owns the heavy pipeline. The Redis URL is shared via REDIS_URL.
//
// Env (see .env.example):
//   SNIPER_REALTIME_ENABLED           — 'true' to run; anything else exits
//                                       immediately (default off).
//   SNIPER_REALTIME_MAX_EVENTS_PER_MIN — sliding-window rate limit (default 4).
//   SNIPER_REALTIME_COOLDOWN_MS        — per-contract cooldown via the
//                                       pipeline's seen-state (default 15m).
//   REDIS_URL                          — defaults redis://localhost:6379.
//
// Run: npm run realtime:consumer
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { getRedisClient, closeRedis } from '@/lib/redis'
import { onRealtimeToken, realtimeEnabled, type RealtimeScoredToken } from '@/lib/modules/derived/realtime-sniper-bridge'

const CHANNEL = 'nexus:realtime-sniper'

async function main(): Promise<void> {
  if (!realtimeEnabled()) {
    console.log('[realtime-sniper-consumer] SNIPER_REALTIME_ENABLED is not "true" — exiting (no-op).')
    return
  }

  const redis = getRedisClient()
  await redis.ping()
  console.log(`[realtime-sniper-consumer] subscribed to ${CHANNEL}`)

  redis.subscribe(CHANNEL, (err) => {
    if (err) {
      console.error('[realtime-sniper-consumer] subscribe failed:', err.message)
      process.exit(1)
    }
  })

  redis.on('message', async (...args: unknown[]) => {
    const [channel, message] = args as [string, string]
    if (channel !== CHANNEL) return
    let token: RealtimeScoredToken
    try {
      token = JSON.parse(message) as RealtimeScoredToken
    } catch (err) {
      console.error('[realtime-sniper-consumer] bad JSON event dropped:',
        err instanceof Error ? err.message : String(err))
      return
    }
    // onRealtimeToken never throws; it env-gates, rate-limits, runs the
    // shared pipeline, and logs the decision itself.
    try {
      await onRealtimeToken(token)
    } catch (err) {
      // Defensive: the bridge is not supposed to throw, but a subscriber
      // handler must never take down the process.
      console.error('[realtime-sniper-consumer] handler error:',
        err instanceof Error ? err.message : String(err))
    }
  })

  const shutdown = async (signal: string) => {
    console.log(`[realtime-sniper-consumer] ${signal} — closing`)
    try { await closeRedis() } catch { /* best-effort */ }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[realtime-sniper-consumer] FATAL:', err)
  process.exit(1)
})
