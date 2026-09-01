// ─── API Key Authentication System ────────────────────────
// Manages API keys for external service access.
// Keys are stored in Prisma (UserApiKey table) for durability.
// ─────────────────────────────────────────────────────────

import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/db'

export interface ApiKey {
  id: string
  key: string
  name: string
  tier: 'free' | 'pro' | 'enterprise'
  createdAt: string
  lastUsedAt: string | null
  requestCount: number
  rateLimit: number // requests per day
  isActive: boolean
  windowStart: number // timestamp when current rate-limit window began
}

// In-memory cache of validated keys (hydrated from DB on first use).
const keys = new Map<string, ApiKey>()

const rateLimits: Record<string, number> = {
  free: 100,
  pro: 1000,
  enterprise: 10000,
}

// Generate a new API key and persist to DB
export async function generateApiKey(params: {
  name: string
  tier: 'free' | 'pro' | 'enterprise'
  userId?: string
}): Promise<ApiKey> {
  const key = `nexus_${randomBytes(24).toString('hex')}`
  const id = createHash('sha256').update(key).digest('hex').substring(0, 16)

  const apiKey: ApiKey = {
    id,
    key,
    name: params.name,
    tier: params.tier,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    requestCount: 0,
    rateLimit: rateLimits[params.tier],
    isActive: true,
    windowStart: Date.now(),
  }

  // Register in-memory first so validateApiKey sees it immediately.
  keys.set(key, apiKey)

  // Persist to DB (hash only — the raw key is never stored).
  if (params.userId) {
    await prisma.userApiKey.create({
      data: {
        id,
        userId: params.userId,
        service: params.name,
        apiKey: createHash('sha256').update(key).digest('hex'),
        isActive: true,
        tier: params.tier,
        createdAt: new Date(),
      },
    }).catch(() => {
      // DB write failure — in-memory copy still works for this process
    })
  }

  return apiKey
}

// Validate an API key (checks in-memory cache; hydrate from DB on miss).
export async function validateApiKey(key: string): Promise<ApiKey | null> {
  let apiKey = keys.get(key)
  if (!apiKey) {
    // Hydrate from DB: match against stored hash so pre-restart keys work.
    const hash = createHash('sha256').update(key).digest('hex')
    const row = await prisma.userApiKey.findUnique({ where: { id: hash.slice(0, 16) } }).catch(() => null)
    if (!row) return null
    const tier = (['free', 'pro', 'enterprise'] as const).includes(row.tier as 'free' | 'pro' | 'enterprise')
      ? (row.tier as 'free' | 'pro' | 'enterprise')
      : 'free'
    apiKey = {
      id: row.id,
      key,
      name: row.service,
      tier,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      requestCount: 0,
      rateLimit: rateLimits[tier],
      isActive: row.isActive,
      windowStart: Date.now(),
    }
    keys.set(key, apiKey)
  }
  if (!apiKey.isActive) return null

  // Reset counter if window expired (24h)
  const dayMs = 24 * 60 * 60 * 1000
  if (Date.now() - apiKey.windowStart >= dayMs) {
    apiKey.requestCount = 0
    apiKey.windowStart = Date.now()
    keys.set(key, apiKey)
  }

  apiKey.lastUsedAt = new Date().toISOString()
  apiKey.requestCount++
  return apiKey
}

// Get key info (without revealing the key)
export function getKeyInfo(key: string): Omit<ApiKey, 'key'> | null {
  const apiKey = keys.get(key)
  if (!apiKey) return null

  const { key: _, ...info } = apiKey
  return info
}

// List all user's keys (scoped to userId)
export async function listUserKeys(userId: string): Promise<Omit<ApiKey, 'key'>[]> {
  const dbKeys = await prisma.userApiKey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return dbKeys.map((k) => {
    const tier = (['free', 'pro', 'enterprise'] as const).includes(k.tier as 'free' | 'pro' | 'enterprise')
      ? (k.tier as 'free' | 'pro' | 'enterprise')
      : 'free'
    return {
      id: k.id,
      name: k.service,
      tier,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: null,
      requestCount: 0,
      rateLimit: rateLimits[tier],
      isActive: k.isActive,
      windowStart: Date.now(),
    }
  })
}

export type RevokeResult = 'ok' | 'not_found' | 'persist_failed'

// Revoke a key. Persists isActive=false to the DB row (by key hash) so the
// revocation survives a restart — the in-memory Map may be empty after a fresh
// process, so we must always update the DB. DB write happens first; in-memory
// state only flips on success so we never report "revoked" while the durable
// record still says active.
export async function revokeApiKey(key: string, userId?: string): Promise<RevokeResult> {
  const id = createHash('sha256').update(key).digest('hex').substring(0, 16)
  try {
    // When userId is given, scope the update — a key owned by another user
    // matches zero rows, so we never revoke keys we don't own.
    const result = await prisma.userApiKey.updateMany({
      where: userId ? { id, userId } : { id },
      data: { isActive: false },
    })
    if (result.count === 0) return 'not_found'
  } catch (err) {
    console.error('[api-keys] revoke persistence failed', err)
    return 'persist_failed'
  }
  const apiKey = keys.get(key)
  if (apiKey) apiKey.isActive = false
  return 'ok'
}

// Check rate limit (per-day window)
export function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const apiKey = keys.get(key)
  if (!apiKey) return { allowed: false, remaining: 0 }

  const remaining = Math.max(0, apiKey.rateLimit - apiKey.requestCount)
  return { allowed: remaining > 0, remaining }
}

// Tier configuration
export const TIER_CONFIG = {
  free: {
    rateLimit: 100,
    features: ['market-data', 'macro', 'news'],
    description: 'Basic market data access',
  },
  pro: {
    rateLimit: 1000,
    features: ['market-data', 'macro', 'news', 'on-chain', 'signals', 'screener'],
    description: 'Full data access + signals',
  },
  enterprise: {
    rateLimit: 10000,
    features: ['market-data', 'macro', 'news', 'on-chain', 'signals', 'screener', 'historical', 'websocket'],
    description: 'Unlimited access + WebSocket streaming',
  },
} as const