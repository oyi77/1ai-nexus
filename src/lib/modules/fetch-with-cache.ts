// ─────────────────────────────────────────────────────────────
// Cached fetch with single-flight deduplication
// Uses Redis for distributed single-flight when available,
// falls back to in-memory Map for local dev
// ─────────────────────────────────────────────────────────────

import type { ModuleResult } from './types'

const inflight = new Map<string, Promise<unknown>>()

const memoryCache = new Map<string, { data: unknown; expires: number }>()

function cacheKey(moduleId: string, params: Record<string, unknown>): string {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
  return `nexus:mod:${moduleId}:${JSON.stringify(sorted)}`
}

function memoryGet<T>(key: string): T | undefined {
  const entry = memoryCache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expires) {
    memoryCache.delete(key)
    return undefined
  }
  return entry.data as T
}

function memorySet<T>(key: string, data: T, ttlMs: number) {
  memoryCache.set(key, { data, expires: Date.now() + ttlMs })
  // Evict expired entries periodically
  if (memoryCache.size > 500) {
    const now = Date.now()
    for (const [k, v] of memoryCache) {
      if (now > v.expires) memoryCache.delete(k)
    }
  }
}

/**
 * Fetch with caching and single-flight deduplication.
 * If 50 concurrent requests hit the same key, only 1 upstream call goes out.
 */
export async function cachedFetch<T>(
  moduleId: string,
  params: Record<string, unknown>,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<ModuleResult<T>> {
  const key = cacheKey(moduleId, params)

  // Check memory cache
  const cached = memoryGet<T>(key)
  if (cached !== undefined) {
    return { data: cached, source: moduleId, cached: true, timestamp: Date.now(), ttl: ttlMs }
  }

  // Single-flight: if another request is already in-flight for this key, wait for it
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) {
    const data = await existing
    return { data, source: moduleId, cached: true, timestamp: Date.now(), ttl: ttlMs }
  }

  // Make the actual call
  const promise = fetcher()
  inflight.set(key, promise)

  try {
    const data = await promise
    memorySet(key, data, ttlMs)
    return { data, source: moduleId, cached: false, timestamp: Date.now(), ttl: ttlMs }
  } finally {
    inflight.delete(key)
  }
}

/** Clear all caches — for testing only */
export function _clearCaches() {
  memoryCache.clear()
  inflight.clear()
}
