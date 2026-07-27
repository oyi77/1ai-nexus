// ─── Redis Client ─────────────────────────────────────────
// Lazy-loaded Redis client. Only loads ioredis when first used.
// Safe for edge runtime (no-op if not in Node.js).
// ─────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.version === 'string' && process.version.startsWith('v')
}

export interface RedisPipeline {
  zremrangebyscore(key: string, min: number, max: number): void
  zadd(key: string, score: number, member: string): void
  zcard(key: string): void
  pexpire(key: string, ms: number): void
  exec(): Promise<Array<[Error | null, unknown]> | null>
}

export interface RedisClient {
  ping(): Promise<string>
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null>
  del(...keys: string[]): Promise<number>
  dbsize(): Promise<number>
  info(section?: string): Promise<string>
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string, callback: (err: Error | null, count: number) => void): void
  multi(): RedisPipeline
  quit(): Promise<'OK'>
  on(event: string, handler: (...args: unknown[]) => void): void
}

export function getRedisClient(): RedisClient {
  if (!isNodeRuntime()) {
    // Edge runtime — return a no-op proxy
    return new Proxy({}, {
      get: (_target: unknown, prop: string) => {
        if (prop === 'ping') return async () => 'PONG'
        if (prop === 'get') return async () => null
        if (prop === 'set') return async () => 'OK'
        if (prop === 'del') return async () => 0
        if (prop === 'subscribe') return async () => {}
        if (prop === 'publish') return async () => 0
        return () => {}
      },
    }) as unknown as RedisClient
  }

  if (!client) {
    // Lazy load ioredis only in Node.js runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis')

    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 10) return null
        return Math.min(times * 200, 5000)
      },
      enableReadyCheck: true,
      lazyConnect: false,
    })

    client.on('error', (err: Error) => {
      console.error('[Redis] Connection error:', err.message)
    })

    client.on('connect', () => {
      try {
        const parsed = new URL(REDIS_URL)
        console.log('[Redis] Connected to', parsed.host)
      } catch {
        console.log('[Redis] Connected')
      }
    })

    client.on('reconnecting', (delay: number) => {
      console.warn('[Redis] Reconnecting in', delay, 'ms')
    })
  }

  return client
}

export async function closeRedis(): Promise<void> {
  if (client && typeof client.quit === 'function') {
    await client.quit()
    client = null
  }
}
