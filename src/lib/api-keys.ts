// ─── API Key Authentication System ────────────────────────
// Manages API keys for external service access.
// Keys are stored in Redis with metadata.
// ─────────────────────────────────────────────────────────

import { randomBytes, createHash } from 'crypto'

export interface ApiKey {
  id: string
  key: string
  name: string
  tier: 'free' | 'pro' | 'enterprise'
  createdAt: string
  lastUsedAt: string | null
  requestCount: number
  rateLimit: number // requests per minute
  isActive: boolean
}

// In-memory store (replace with Redis/DB in production)
const keys = new Map<string, ApiKey>()

// Generate a new API key
export function generateApiKey(params: {
  name: string
  tier: 'free' | 'pro' | 'enterprise'
}): ApiKey {
  const key = `nexus_${randomBytes(24).toString('hex')}`
  const id = createHash('sha256').update(key).digest('hex').substring(0, 16)

  const rateLimits: Record<string, number> = {
    free: 100,
    pro: 1000,
    enterprise: 10000,
  }

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
  }

  keys.set(key, apiKey)
  return apiKey
}

// Validate an API key
export function validateApiKey(key: string): ApiKey | null {
  const apiKey = keys.get(key)
  if (!apiKey || !apiKey.isActive) return null

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

// List all keys (admin)
export function listApiKeys(): Omit<ApiKey, 'key'>[] {
  return Array.from(keys.values()).map(({ key: _, ...info }) => info)
}

// Revoke a key
export function revokeApiKey(key: string): boolean {
  const apiKey = keys.get(key)
  if (!apiKey) return false
  apiKey.isActive = false
  return true
}

// Check rate limit
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
