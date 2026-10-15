// ─────────────────────────────────────────────────────────────
// Unified prefixed-key TTL seen/dedup store.
//
// `SniperReviewSeen` (`key @unique`, `seenAt`, `expiresAt`) is the primary
// store for every scanner dedup namespace. Each namespace is a key prefix
// with its own TTL:
//
//   review:<contract>                    review digest seen        (6h)
//   scan:<chain>:<contract>              sniper scan seen          (1h)
//   ticker:<chain>:<normalizedTicker>    ticker copycat dedup      (1h)
//   confluence:<contract>                confluence alert seen     (6h)
//   accumulation:<contract>              accumulation alert seen   (6h)
//   kolscan:<signature>                  KOLScan tx seen           (6h)
//
// CRITICAL INVARIANT — dedup state must never crash a scan pass, an alert
// cron or a review digest. Every DB operation is wrapped; on failure we
// fall back to the namespace's local JSON file. Writes are dual-write: DB
// upsert AND JSON backup. Nothing exported here throws.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'

export const REVIEW_SEEN_TTL_MS = 6 * 60 * 60_000
export const SNIPER_SCAN_SEEN_TTL_MS = 60 * 60_000
export const TICKER_SEEN_TTL_MS = 60 * 60_000
export const CONFLUENCE_SEEN_TTL_MS = 6 * 60 * 60_000
export const ACCUMULATION_SEEN_TTL_MS = 6 * 60 * 60_000
export const KOLSCAN_SEEN_TTL_MS = 6 * 60 * 60_000
/**
 * Kill-switch: when `SNIPER_SEEN_DB` is 'off'/'false'/'0', ALL prisma calls
 * are skipped — reads go straight to the JSON namespace file, writes go only
 * to JSON, no errors logged. Used by tests to avoid polluting the live DB.
 */
export function isSeenDbDisabled(): boolean {
  const v = process.env.SNIPER_SEEN_DB
  return v === 'off' || v === 'false' || v === '0'
}

const NAMESPACE_TTL_MS: Record<string, number> = {
  review: REVIEW_SEEN_TTL_MS,
  scan: SNIPER_SCAN_SEEN_TTL_MS,
  ticker: TICKER_SEEN_TTL_MS,
  confluence: CONFLUENCE_SEEN_TTL_MS,
  accumulation: ACCUMULATION_SEEN_TTL_MS,
  kolscan: KOLSCAN_SEEN_TTL_MS,
}

function getJsonPath(namespace: string): string {
  if (namespace === 'scan' || namespace === 'ticker') {
    return process.env.SNIPER_SEEN_PATH || join(process.cwd(), 'data', 'sniper-seen.json')
  }
  if (namespace === 'review') {
    return process.env.SNIPER_REVIEW_SEEN_PATH || join(process.cwd(), 'data', 'sniper-review-seen.json')
  }
  if (namespace === 'confluence') {
    return process.env.CONFLUENCE_SEEN_PATH || join(process.cwd(), 'data', 'confluence-seen.json')
  }
  if (namespace === 'accumulation') {
    return process.env.ACCUMULATION_STATE_PATH || join(process.cwd(), 'data', 'accumulation-alert-state.json')
  }
  if (namespace === 'kolscan') {
    return process.env.KOLSCAN_SEEN_PATH || join(process.cwd(), 'data', 'kolscan-seen.json')
  }
  return join(process.cwd(), 'data', `${namespace}-seen.json`)
}

export function toJsonKey(key: string): { namespace: string; jsonKey: string } | null {
  const idx = key.indexOf(':')
  if (idx <= 0) return null
  const namespace = key.slice(0, idx)
  const remainder = key.slice(idx + 1)
  if (namespace === 'scan') {
    return { namespace: 'scan', jsonKey: remainder }
  }
  if (namespace === 'ticker') {
    const parts = remainder.split(':')
    const ticker = parts.length > 1 ? parts.slice(1).join(':') : parts[0]
    return { namespace: 'ticker', jsonKey: `ticker:${ticker}` }
  }
  if (
    namespace === 'review' ||
    namespace === 'confluence' ||
    namespace === 'accumulation' ||
    namespace === 'kolscan'
  ) {
    return { namespace, jsonKey: remainder }
  }
  return null
}

function readJsonSeen(namespace: string): Map<string, number> {
  const out = new Map<string, number>()
  const path = getJsonPath(namespace)
  try {
    if (!existsSync(path)) return out
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
    const cutoff = Date.now() - (NAMESPACE_TTL_MS[namespace] ?? REVIEW_SEEN_TTL_MS)
    for (const [key, at] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at) && at >= cutoff) out.set(key, at)
    }
  } catch {
    // unreadable/corrupt JSON state reads as empty
  }
  return out
}

function writeJsonSeen(namespace: string, jsonKeys: string[], atMs: number): void {
  const path = getJsonPath(namespace)
  try {
    const next = readJsonSeen(namespace)
    for (const jsonKey of jsonKeys) next.set(jsonKey, atMs)
    const obj: Record<string, number> = {}
    for (const [key, at] of next) obj[key] = at
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(obj, null, 2))
  } catch {
    // backup write is best-effort
  }
}

function updateJsonBackup(keys: string[], atMs: number): void {
  const byNamespace: Record<string, string[]> = {}
  for (const key of keys) {
    const mapping = toJsonKey(key)
    if (!mapping) continue
    if (!byNamespace[mapping.namespace]) byNamespace[mapping.namespace] = []
    byNamespace[mapping.namespace].push(mapping.jsonKey)
  }
  for (const [ns, jsonKeys] of Object.entries(byNamespace)) {
    writeJsonSeen(ns, jsonKeys, atMs)
  }
}

export function fallbackIsSeen(key: string): boolean {
  const mapping = toJsonKey(key)
  if (!mapping) return false
  const jsonSeen = readJsonSeen(mapping.namespace)
  return jsonSeen.has(mapping.jsonKey) || jsonSeen.has(key)
}

/**
 * True when the key exists in `SniperReviewSeen` and has not expired.
 * Expired rows are lazily deleted. On DB failure the namespace JSON file is
 * consulted instead. Never throws.
 */
export async function isKeySeen(key: string): Promise<boolean> {
  if (isSeenDbDisabled()) return fallbackIsSeen(key)
  const now = new Date()
  try {
    const row = await prisma.sniperReviewSeen.findUnique({ where: { key } })
    if (!row) return false
    if (row.expiresAt > now) return true
    prisma.sniperReviewSeen.delete({ where: { key } }).catch(() => {})
    return false
  } catch {
    return fallbackIsSeen(key)
  }
}

/**
 * Upsert the key with `ttlMs`. Dual-write: DB row + namespace JSON backup.
 * Never throws.
 */
export async function markKeySeen(key: string, ttlMs: number): Promise<void> {
  const now = new Date()
  if (!isSeenDbDisabled()) {
    const expiresAt = new Date(now.getTime() + ttlMs)
    try {
      await prisma.sniperReviewSeen.upsert({
        where: { key },
        create: { key, seenAt: now, expiresAt },
        update: { seenAt: now, expiresAt },
      })
    } catch {
      // fall through to JSON backup
    }
  }
  updateJsonBackup([key], now.getTime())
}

/**
 * Delete every expired row. Returns the deleted count, or -1 when the DB is
 * unreachable. Never throws.
 */
export async function pruneExpiredKeys(): Promise<number> {
  if (isSeenDbDisabled()) return 0
  try {
    const res = await prisma.sniperReviewSeen.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    return res.count
  } catch {
    return -1
  }
}

/**
 * Batch check: return only the keys that are NOT currently live in the DB
 * (order preserved, duplicates removed). On DB failure, returns the keys
 * missing from the JSON fallback instead. Never throws.
 */
export async function filterUnseenKeys(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return []
  const unique = [...new Set(keys)]
  if (isSeenDbDisabled()) {
    return unique.filter((key) => !fallbackIsSeen(key))
  }
  const now = new Date()
  try {
    const rows = await prisma.sniperReviewSeen.findMany({
      where: { key: { in: unique }, expiresAt: { gt: now } },
      select: { key: true },
    })
    const seen = new Set(rows.map((r) => r.key))
    return unique.filter((key) => !seen.has(key))
  } catch {
    return unique.filter((key) => !fallbackIsSeen(key))
  }
}

export async function markKeysSeen(keys: string[], ttlMs: number): Promise<void> {
  if (keys.length === 0) return
  const unique = [...new Set(keys)]
  const now = new Date()
  if (!isSeenDbDisabled()) {
    const expiresAt = new Date(now.getTime() + ttlMs)
    try {
      for (const key of unique) {
        await prisma.sniperReviewSeen.upsert({
          where: { key },
          create: { key, seenAt: now, expiresAt },
          update: { seenAt: now, expiresAt },
        })
      }
    } catch {
      // fall through to JSON backup
    }
  }
  updateJsonBackup(unique, now.getTime())
}

function chainContractKey(chain: string, contract: string): string {
  const c = (chain || '').toLowerCase()
  const evmLike =
    c === 'ethereum' ||
    c === 'bsc' ||
    c === 'base' ||
    c === 'arbitrum' ||
    c === 'polygon' ||
    c === 'avalanche' ||
    c === 'optimism'
  return `${c}:${evmLike || contract.startsWith('0x') ? contract.toLowerCase() : contract}`
}

export function isReviewSeen(contract: string): Promise<boolean> {
  return isKeySeen(`review:${contract}`)
}
export function markReviewSeen(contract: string, ttlMs: number = REVIEW_SEEN_TTL_MS): Promise<void> {
  return markKeySeen(`review:${contract}`, ttlMs)
}

export function isScanSeen(chain: string, contract: string): Promise<boolean> {
  return isKeySeen(`scan:${chainContractKey(chain, contract)}`)
}
export function markScanSeen(
  chain: string,
  contract: string,
  ttlMs: number = SNIPER_SCAN_SEEN_TTL_MS,
): Promise<void> {
  return markKeySeen(`scan:${chainContractKey(chain, contract)}`, ttlMs)
}

export function isTickerSeen(chain: string, normalizedTicker: string): Promise<boolean> {
  return isKeySeen(`ticker:${(chain || '').toLowerCase()}:${normalizedTicker}`)
}
export function markTickerSeen(
  chain: string,
  normalizedTicker: string,
  ttlMs: number = TICKER_SEEN_TTL_MS,
): Promise<void> {
  return markKeySeen(`ticker:${(chain || '').toLowerCase()}:${normalizedTicker}`, ttlMs)
}

export function isConfluenceSeen(contract: string): Promise<boolean> {
  return isKeySeen(`confluence:${contract}`)
}
export function markConfluenceSeen(contract: string, ttlMs: number = CONFLUENCE_SEEN_TTL_MS): Promise<void> {
  return markKeySeen(`confluence:${contract}`, ttlMs)
}

export function isAccumulationSeen(contract: string): Promise<boolean> {
  return isKeySeen(`accumulation:${contract}`)
}
export function markAccumulationSeen(
  contract: string,
  ttlMs: number = ACCUMULATION_SEEN_TTL_MS,
): Promise<void> {
  return markKeySeen(`accumulation:${contract}`, ttlMs)
}

export function filterUnseenSignatures(signatures: string[]): Promise<string[]> {
  return filterUnseenKeys(signatures.map((signature) => `kolscan:${signature}`))
}
export function markSignaturesSeen(
  signatures: string[],
  ttlMs: number = KOLSCAN_SEEN_TTL_MS,
): Promise<void> {
  return markKeysSeen(
    signatures.map((signature) => `kolscan:${signature}`),
    ttlMs,
  )
}
