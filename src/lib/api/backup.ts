// ─────────────────────────────────────────────────────────────
// Redis-Backed Last-Known-Good Backup Store
// Fallback mechanism to ensure APIs always return data when
// upstream sources fail or return rate-limit errors (429)
// ─────────────────────────────────────────────────────────────

import { getRedisClient } from '@/lib/redis'

/**
 * Save a JSON-serialized payload as a permanent backup (no TTL)
 */
export async function saveBackup<T>(key: string, data: T): Promise<boolean> {
  try {
    const redis = getRedisClient()
    if (!redis) return false
    await redis.set(`nexus:backup:${key}`, JSON.stringify(data))
    return true
  } catch (e) {
    console.error(`[backup] Failed to save backup for ${key}:`, e)
    return false
  }
}

/**
 * Retrieve the last-known-good backup payload
 */
export async function getBackup<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null
    const raw = await redis.get(`nexus:backup:${key}`)
    return raw ? JSON.parse(raw) as T : null
  } catch (e) {
    console.error(`[backup] Failed to get backup for ${key}:`, e)
    return null
  }
}
