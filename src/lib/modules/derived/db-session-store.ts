// ─────────────────────────────────────────────────────────────
// Session tokens — DB-primary store with automatic JSON fallback.
//
// Migrated 2026-10-15 (operator directive: prefer DB over JSON).
// One row per provider in `SessionToken` (`provider @unique`).
// The `data` column is opaque Json — provider-specific shapes
// (alphio {accessToken,…}, gmgn {cookie}, moby/stockbit pairs)
// never need schema changes.
//
// Invariants (mirrors db-seen-store.ts):
//   • NEVER-FAIL: every DB op is wrapped; nothing exported throws.
//   • DUAL-WRITE: saves go to BOTH Prisma and the legacy JSON file.
//   • Reads try DB first, fall back to JSON when the DB fails or
//     has no row while JSON has data.
//   • Kill-switch SESSION_DB=off skips ALL prisma calls (tests).
//   • Sync callers (alphio/gmgn resolve paths) keep using the JSON
//     file synchronously; the DB mirror is written fire-and-forget.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `SESSION_DB` is 'off'/'false'/'0', ALL prisma calls are
 * skipped — reads go straight to the JSON file, writes go only to JSON, no
 * errors logged. Mirrors the SNIPER_SEEN_DB pattern in db-seen-store. Used
 * by tests to avoid the backfilled live DB shadowing temp session files.
 */
export function isSessionDbDisabled(): boolean {
  const v = process.env.SESSION_DB
  return v === 'off' || v === 'false' || v === '0'
}

// Provider → legacy JSON filename (dual-write backup target).
const PROVIDER_JSON_FILE: Record<string, string> = {
  alphio: 'alphio-session.json',
  gmgn: 'gmgn-session.json',
  moby: 'moby-session.json',
  'moby-fallback': 'moby-session-fallback.json',
  stockbit: 'stockbit-session.json',
}

function jsonPathFor(provider: string): string | null {
  const file = PROVIDER_JSON_FILE[provider]
  if (!file) return null
  const overrideEnv =
    provider === 'alphio'
      ? process.env.ALPHIO_SESSION_PATH
      : provider === 'gmgn'
        ? process.env.GMGN_SESSION_PATH
        : provider === 'moby'
          ? process.env.MOBY_SESSION_PATH
          : provider === 'moby-fallback'
            ? process.env.MOBY_FALLBACK_SESSION_PATH
            : process.env.STOCKBIT_SESSION_PATH
  return overrideEnv || join(process.cwd(), 'data', file)
}

function readJsonBackup(provider: string): unknown | null {
  const path = jsonPathFor(provider)
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

function writeJsonBackup(provider: string, data: unknown): void {
  const path = jsonPathFor(provider)
  if (!path) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2))
    try {
      chmodSync(path, 0o600)
    } catch {
      /* best effort */
    }
  } catch (err) {
    console.error(`[db-session-store] JSON backup write failed for ${provider}: ${errorMessage(err)}`)
  }
}

/**
 * Persist a provider session. DB upsert first (unless SESSION_DB=off), then
 * dual-write the legacy JSON file. Never throws. Fire-and-forget safe.
 */
export async function saveSessionToken(
  provider: string,
  data: unknown,
  expiresAt?: Date | null,
): Promise<void> {
  const payload = JSON.parse(JSON.stringify(data ?? null)) as Prisma.InputJsonValue
  if (!isSessionDbDisabled()) {
    try {
      await prisma.sessionToken.upsert({
        where: { provider },
        create: { provider, data: payload, expiresAt: expiresAt ?? null },
        update: { data: payload, expiresAt: expiresAt ?? null },
      })
    } catch (err) {
      console.error(`[db-session-store] saveSessionToken DB write failed for ${provider}: ${errorMessage(err)}`)
    }
  }
  writeJsonBackup(provider, data)
}

/**
 * Load a provider session. DB first (unless SESSION_DB=off); JSON fallback
 * when the DB fails or has no row while JSON has data. Never throws.
 */
export async function loadSessionToken<T = unknown>(provider: string): Promise<T | null> {
  if (!isSessionDbDisabled()) {
    try {
      const row = await prisma.sessionToken.findUnique({ where: { provider } })
      if (row) return row.data as T
    } catch (err) {
      console.error(`[db-session-store] loadSessionToken DB read failed for ${provider}: ${errorMessage(err)}`)
    }
  }
  return (readJsonBackup(provider) as T) ?? null
}

/**
 * Sync mirror helper for sync callers (alphio write path, gmgn cookie
 * staging). Writes JSON synchronously, then mirrors to the DB
 * fire-and-forget. Never throws — safe to call without await.
 */
export function mirrorSessionTokenSync(provider: string, data: unknown, expiresAt?: Date | null): void {
  writeJsonBackup(provider, data)
  void saveSessionToken(provider, data, expiresAt).catch(() => {
    /* saveSessionToken never throws; belt-and-braces for unhandled rejections */
  })
}

/**
 * Reset helper for tests: clear the module's JSON-path overrides only.
 * (There is no module-level cache in this store.)
 */
export function __resetSessionStoreForTests(): void {
  // No-op by design — documented seam for symmetry with other stores.
}
