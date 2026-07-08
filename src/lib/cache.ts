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
 
 /**
  * Sliding window rate limiter using Redis.
  * @param key - Unique identifier for the rate limit bucket (e.g., "user:123:free")
  * @param limit - Maximum number of requests allowed in the window
  * @param windowMs - Time window in milliseconds (e.g., 3600000 for 1 hour)
  * @returns Object with allowed (boolean) and remaining (number) fields
  */
 export async function checkRateLimit(
   key: string,
   limit: number,
   windowMs: number
 ): Promise<{ allowed: boolean; remaining: number }> {
   const r = getRedis()
   
   // If Redis is unavailable, allow the request (fail open)
   if (!r) return { allowed: true, remaining: limit }
 
   const redisKey = `nexus:ratelimit:${key}`
   const now = Date.now()
   const windowStart = now - windowMs
 
   try {
     // Use Redis sorted set with timestamps as scores for sliding window
     // Remove old entries outside the current window
     await r.zremrangebyscore(redisKey, 0, windowStart)
     
     // Count current requests in the window
     const currentCount = await r.zcard(redisKey)
     
     if (currentCount >= limit) {
       return { allowed: false, remaining: 0 }
     }
     
     // Add current request with timestamp as score
     await r.zadd(redisKey, now, `${now}:${Math.random()}`)
     
     // Set expiration to window + 1 second (cleanup)
     await r.expire(redisKey, Math.ceil(windowMs / 1000) + 1)
     
     return { allowed: true, remaining: limit - currentCount - 1 }
   } catch (err) {
     // On Redis error, fail open to avoid blocking legitimate traffic
     console.error('[checkRateLimit] Redis error:', err)
     return { allowed: true, remaining: limit }
   }
 }
