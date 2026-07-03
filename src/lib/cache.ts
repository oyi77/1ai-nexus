// ─────────────────────────────────────────────────────────────
// Redis Cache — edge-safe, cross-worker cache layer
// Extracted from data-refresher.ts to isolate from Prisma imports.
// API routes import from here; data-refresher.ts re-exports for orchestrator use.
// ─────────────────────────────────────────────────────────────

import type { Redis as RedisClient } from 'ioredis'

let redis: RedisClient | null = null

function createRedis(): RedisClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Redis = require('ioredis')
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    retryStrategy(times: number) { return Math.min(times * 200, 2000) },
    lazyConnect: true,
  })
}

function getRedis(): RedisClient | null {
  if (!redis) {
    try {
      redis = createRedis()
    } catch { return null }
  }
  return redis
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis()
  if (!r) return null
  try {
    const raw = await r.get(`nexus:cache:${key}`)
    return raw ? JSON.parse(raw) as T : null
  } catch { return null }
}

export async function cacheSet(key: string, data: unknown, ttlSeconds = 300): Promise<void> {
  const r = getRedis()
  if (!r) return
  try {
    await r.set(`nexus:cache:${key}`, JSON.stringify(data), 'EX', ttlSeconds)
  } catch { /* non-fatal */ }
}
