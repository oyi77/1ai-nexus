// ─────────────────────────────────────────────────────────────
// BotX API keys — DB-primary store with SQLite fallback.
//
// Migrated 2026-10-16 (operator directive: prefer DB over JSON/SQLite).
// `BotXKey` (PostgreSQL via Prisma) is the PRIMARY store for BotX
// rotating API keys (was data/botx-keys.sqlite via node:sqlite).
//
// The credential-manager (src/lib/modules/meme/_auth/credential-manager.ts)
// keeps its synchronous SQLite path for getNextKey / markRateLimited /
// markHealthy / markUnhealthy (these are called inside hot request paths
// that must never await). This module provides an ASYNC sync path:
// saveBotXKeys() upserts the full key set into Postgres so the key roster
// is visible across processes; loadBotXKeys() reads DB-first.
//
// Invariants (mirrors db-session-store.ts):
//   • NEVER-FAIL: every DB op is wrapped; nothing exported throws.
//   • DUAL-WRITE: the credential-manager keeps writing SQLite; this store
//     mirrors to Postgres. SQLite stays the synchronous fallback.
//   • Kill-switch BOTX_DB=off skips ALL prisma calls.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `BOTX_DB` is 'off'/'false'/'0', ALL prisma
 * calls are skipped. Used by tests to avoid polluting the live DB.
 */
export function isBotxDbDisabled(): boolean {
  const v = process.env.BOTX_DB
  return v === 'off' || v === 'false' || v === '0'
}

// ── Public row shape (mirrors credential-manager BotXKey interface) ──

export interface BotXKeyRow {
  id: string
  apiKey: string
  email: string
  createdAt: number // epoch ms
  lastUsed: number
  lastChecked: number
  isHealthy: boolean
  rateLimited: boolean
  errorCount: number
  requestCount: number
}

// ── Row mappers ──────────────────────────────────────────────

function toRow(input: BotXKeyRow): Prisma.BotXKeyUpsertArgs['create'] {
  return {
    apiKey: input.apiKey,
    email: input.email,
    createdAt: new Date(input.createdAt),
    lastUsed: new Date(input.lastUsed),
    lastChecked: new Date(input.lastChecked),
    isHealthy: input.isHealthy,
    rateLimited: input.rateLimited,
    errorCount: input.errorCount,
    requestCount: input.requestCount,
  }
}

function fromRow(row: {
  id: string
  apiKey: string
  email: string
  createdAt: Date
  lastUsed: Date
  lastChecked: Date
  isHealthy: boolean
  rateLimited: boolean
  errorCount: number
  requestCount: number
}): BotXKeyRow {
  return {
    id: row.apiKey, // credential-manager keys by sha256(apiKey); the DB id is a cuid
    apiKey: row.apiKey,
    email: row.email,
    createdAt: row.createdAt.getTime(),
    lastUsed: row.lastUsed.getTime(),
    lastChecked: row.lastChecked.getTime(),
    isHealthy: row.isHealthy,
    rateLimited: row.rateLimited,
    errorCount: row.errorCount,
    requestCount: row.requestCount,
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Upsert the full BotX key roster into the DB by apiKey. Called after the
 * credential-manager mutates its SQLite store (addKey / markRateLimited /
 * markHealthy / markUnhealthy / removeKey). Idempotent. Never throws.
 */
export async function saveBotXKeys(rows: BotXKeyRow[]): Promise<void> {
  if (isBotxDbDisabled() || rows.length === 0) return
  try {
    for (const input of rows) {
      const data = toRow(input)
      await prisma.botXKey.upsert({
        where: { apiKey: input.apiKey },
        create: data,
        update: {
          email: data.email,
          lastUsed: data.lastUsed,
          lastChecked: data.lastChecked,
          isHealthy: data.isHealthy,
          rateLimited: data.rateLimited,
          errorCount: data.errorCount,
          requestCount: data.requestCount,
        },
      })
    }
  } catch (err) {
    console.error(`[db-botx-keys] DB upsert failed: ${errorMessage(err)}`)
  }
}

/**
 * Load all BotX keys from the DB, ordered by createdAt ASC (matching the
 * credential-manager's loadKeys ordering). Returns [] on failure — the
 * caller falls back to the SQLite store. Never throws.
 */
export async function loadBotXKeys(): Promise<BotXKeyRow[]> {
  if (isBotxDbDisabled()) return []
  try {
    const rows = await prisma.botXKey.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => fromRow(r))
  } catch (err) {
    console.error(`[db-botx-keys] DB read failed: ${errorMessage(err)}`)
    return []
  }
}

/**
 * Load a single key by its apiKey value. Returns null when not found or DB
 * unreachable. Never throws.
 */
export async function loadBotXKeyByKeyValue(apiKey: string): Promise<BotXKeyRow | null> {
  if (isBotxDbDisabled()) return null
  try {
    const row = await prisma.botXKey.findUnique({
      where: { apiKey },
    })
    return row ? fromRow(row) : null
  } catch (err) {
    console.error(`[db-botx-keys] DB read-by-key failed: ${errorMessage(err)}`)
    return null
  }
}
