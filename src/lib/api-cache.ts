// ─── API Response Cache ───────────────────────────────────
// In-memory cache for API responses to reduce external calls.
// TTL-based with automatic cleanup.
// ─────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class ApiCache {
  private static instance: ApiCache
  private cache: Map<string, CacheEntry<unknown>> = new Map()
  private readonly maxSize = 1000

  private constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000)
  }

  static getInstance(): ApiCache {
    if (!ApiCache.instance) {
      ApiCache.instance = new ApiCache()
    }
    return ApiCache.instance
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }
    return entry.data as T
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }
    this.cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs })
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }

  getStats(): { size: number } {
    return { size: this.cache.size }
  }
}

export const apiCache = ApiCache.getInstance()

export async function cachedApiFetch<T>(
  url: string,
  options?: RequestInit & { ttlMs?: number },
): Promise<T> {
  const ttl = options?.ttlMs ?? 60_000
  const cacheKey = `${url}:${JSON.stringify(options?.body ?? '')}`

  const cached = apiCache.get<T>(cacheKey)
  if (cached !== null) return cached

  const res = await fetch(url, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`API ${res.status}: ${url}`)

  const data = await res.json() as T
  apiCache.set(cacheKey, data, ttl)
  return data
}
