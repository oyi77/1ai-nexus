// ─────────────────────────────────────────────────────────────
// Meme Sniper — DB-primary delivery log store with JSON fallback.
//
// `SniperDeliveryLog` (PostgreSQL via Prisma) is the PRIMARY store for
// Telegram delivery observability (was data/sniper-delivery-log.json).
//
// Invariants (identical to db-stores.ts / db-seen-store.ts):
//   • NEVER-FAIL: every DB write is wrapped; a DB outage must never break a
//     delivery send or a cooldown check. When DB write fails, the JSON file
//     is still written.
//   • DUAL-WRITE: JSON is written synchronously FIRST (before any await, so
//     cooldown reads always see the latest entry), then the DB upsert runs
//     async. Other scripts that still read JSON keep working.
//   • Reads try DB first and fall back to JSON when the DB fails or returns
//     empty while JSON has data.
//   • KILL-SWITCH: when SNIPER_DELIVERY_DB is 'off'/'false'/'0', all prisma
//     calls are skipped — reads go straight to JSON, writes go only to JSON.
//     Used by tests to avoid polluting the live DB.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  readSniperDeliveryLog,
  type SniperDeliveryLog,
  type SniperDeliveryLogEntry,
} from './meme-sniper'

export { type SniperDeliveryLog, type SniperDeliveryLogEntry }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `SNIPER_DELIVERY_DB` is 'off'/'false'/'0', ALL prisma
 * calls are skipped — reads go straight to the JSON file, writes go only to
 * JSON, no errors logged. Used by tests to avoid polluting the live DB.
 */
export function isDeliveryDbDisabled(): boolean {
  const v = process.env.SNIPER_DELIVERY_DB
  return v === 'off' || v === 'false' || v === '0'
}

const CHAIN = 'solana'

function deliveryKey(entry: SniperDeliveryLogEntry): string {
  const c = entry.contract ?? 'none'
  return `${c}:${entry.at}`
}

function toDeliveryRow(
  entry: SniperDeliveryLogEntry,
): Prisma.SniperDeliveryLogCreateInput {
  const deliveredAt = Number.isFinite(Date.parse(entry.at))
    ? new Date(entry.at)
    : new Date()
  return {
    deliveryKey: deliveryKey(entry),
    contract: entry.contract ?? null,
    chain: CHAIN,
    chatId: entry.chatId ?? null,
    messageTextPrefix: entry.messageTextPrefix,
    ok: entry.ok,
    status: entry.status,
    error: entry.error,
    attemptCount: entry.attemptCount,
    truncated: entry.truncated,
    deliveredAt,
  }
}

function fromDeliveryRow(row: {
  contract: string | null
  chatId: string | null
  messageTextPrefix: string
  ok: boolean
  status: number | null
  error: string | null
  attemptCount: number
  truncated: boolean
  deliveredAt: Date
}): SniperDeliveryLogEntry {
  return {
    at: row.deliveredAt.toISOString(),
    chatId: row.chatId,
    contract: row.contract,
    messageTextPrefix: row.messageTextPrefix,
    ok: row.ok,
    status: row.status,
    error: row.error,
    attemptCount: row.attemptCount,
    truncated: row.truncated,
  }
}

 /**
 * Upsert delivery entries into the DB by deliveryKey. This is the DB
 * persistence layer only — the JSON ring buffer is written synchronously
 * by the caller (`logEntry` in meme-sniper.ts calls appendSniperDeliveryLog
 * before firing this). Keeping JSON at the call site guarantees the entry
 * is never lost when a cron exits, and that cooldown reads always see it.
 * Never throws.
 */
export async function saveDeliveryEntries(
  entries: SniperDeliveryLogEntry[],
): Promise<void> {
  if (entries.length === 0) return
  if (isDeliveryDbDisabled()) return
  for (const entry of entries) {
    try {
      await prisma.sniperDeliveryLog.upsert({
        where: { deliveryKey: deliveryKey(entry) },
        create: toDeliveryRow(entry),
        update: toDeliveryRow(entry),
      })
    } catch (err) {
      // NEVER-FAIL: a bad row must not break the rest of the sweep.
      console.error(
        `[db-delivery-store] saveDeliveryEntries DB write failed for ${entry.contract ?? 'none'}: ${errorMessage(err)}`,
      )
    }
  }
}

/**
 * Newest-first delivery entries, DB first. Falls back to the JSON ring
 * buffer when the DB fails or has no rows while JSON has data.
 * Never throws.
 */
export async function loadRecentDeliveries(
  limit = 500,
): Promise<SniperDeliveryLogEntry[]> {
  if (isDeliveryDbDisabled()) {
    return readSniperDeliveryLog().entries.slice(0, limit)
  }
  try {
    const rows = await prisma.sniperDeliveryLog.findMany({
      orderBy: { deliveredAt: 'desc' },
      take: limit,
    })
    if (rows.length > 0) return rows.map(fromDeliveryRow)
    return readSniperDeliveryLog().entries.slice(0, limit)
  } catch (err) {
    console.error(
      `[db-delivery-store] loadRecentDeliveries DB read failed: ${errorMessage(err)}`,
    )
    return readSniperDeliveryLog().entries.slice(0, limit)
  }
}

/**
 * Load the full delivery log (entries + updatedAt). DB first; JSON fallback.
 * Never throws.
 */
export async function loadDeliveryLog(): Promise<SniperDeliveryLog> {
  const entries = await loadRecentDeliveries(500)
  return {
    entries,
    updatedAt: entries.length > 0 ? entries[0].at : null,
  }
}
