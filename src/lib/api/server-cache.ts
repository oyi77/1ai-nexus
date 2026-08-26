// ─────────────────────────────────────────────────────────────
// Server-Side Response Cache with Single-Flight Deduplication
// ─────────────────────────────────────────────────────────────
// Problem: 100 users hitting /api/v1/whale-alert = 100 upstream calls
// Solution: First call goes upstream, 99 others wait for the same result
//
// Architecture:
//   Layer 1: In-memory Map (instant, per-process)
//   Layer 2: Redis (shared across PM2 cluster workers)
//   Single-flight: concurrent requests for the same key share one promise
//
// Usage:
//   const cached = await getCached('whale-alert', 60_000, async () => {
//     return await fetchFromUpstream()
//   })
// ─────────────────────────────────────────────────────────────

import { getRedisClient } from '@/lib/redis'

interface CacheEntry {
  data: unknown
  expires: number
}

const memoryCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

// Memory cache limits
const MAX_MEMORY_ENTRIES = 1_000
const CLEANUP_INTERVAL = 60_000 // 1 minute

let lastCleanup = Date.now()

function evictExpired() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of memoryCache) {
    if (now > entry.expires) memoryCache.delete(key)
  }
  // Hard cap
  if (memoryCache.size > MAX_MEMORY_ENTRIES) {
    const entries = [...memoryCache.entries()].sort((a, b) => a[1].expires - b[1].expires)
    const toRemove = entries.slice(0, entries.length - MAX_MEMORY_ENTRIES)
    for (const [key] of toRemove) memoryCache.delete(key)
  }
}

function redisGet(key: string): Promise<string | null> {
  try {
    const redis = getRedisClient()
    return redis.get(key)
  } catch {
    return Promise.resolve(null)
  }
}

function redisSet(key: string, value: string, ttlMs: number): void {
  try {
    const redis = getRedisClient()
    // Fire-and-forget — don't await, don't block the response
    void redis.set(key, value, 'PX', ttlMs).catch(() => {})
  } catch {
    // Redis down — memory cache still works
  }
}

/**
 * Get cached data or fetch fresh. Server-side single-flight dedup.
 * If 100 requests hit the same key simultaneously, only 1 upstream call.
 *
 * @param key    Unique cache key (e.g. 'whale-alert', 'dex:trending:solana')
 * @param ttlMs  Time-to-live in milliseconds
 * @param fetcher  Async function that fetches fresh data
 * @returns      The data (from cache or fresh)
 */
export async function getCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  evictExpired()

  // Layer 1: Memory cache
  const mem = memoryCache.get(key)
  if (mem && Date.now() < mem.expires) {
    return { data: mem.data as T, fromCache: true }
  }

  // Layer 2: Redis cache
  try {
    const raw = await redisGet(key)
    if (raw) {
      const data = JSON.parse(raw) as T
      // Promote to memory
      memoryCache.set(key, { data, expires: Date.now() + ttlMs })
      return { data, fromCache: true }
    }
  } catch {
    // Redis read failure — continue to fetch
  }

  // Single-flight dedup: if another request is already fetching, wait for it
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) {
    const data = await existing
    return { data, fromCache: true }
  }

  // Fetch fresh data
  const promise = fetcher()
  inflight.set(key, promise)

  try {
    const data = await promise

    // Write to both caches
    memoryCache.set(key, { data, expires: Date.now() + ttlMs })
    redisSet(key, JSON.stringify(data), ttlMs)

    return { data, fromCache: false }
  } catch (error) {
    // If fetch fails: serve stale memory, then stale Redis, before throwing.
    const stale = memoryCache.get(key)
    if (stale) {
      return { data: stale.data as T, fromCache: true }
    }
    try {
      const raw = await redisGet(key)
      if (raw) {
        const data = JSON.parse(raw) as T
        memoryCache.set(key, { data, expires: Date.now() + ttlMs })
        return { data, fromCache: true }
      }
    } catch { /* redis stale unavailable too */ }
    throw error
  } finally {
    inflight.delete(key)
  }
}

/**
 * Get current cache stats for monitoring
 */
export function getCacheStats() {
  return {
    memoryEntries: memoryCache.size,
    inflightRequests: inflight.size,
  }
}
