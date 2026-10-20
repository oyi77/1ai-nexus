// ─────────────────────────────────────────────────────────────
// Micro-meta — DB-primary store with automatic JSON fallback.
//
// Migrated 2026-10-15 (operator directive: prefer DB over JSON).
// One row per scope in `StateMeta` (`scope @unique`).
// Known scopes: `feed-health-prev`, `zero-issue-state`, `whale-sheet-sync`.
//
// Invariants (mirrors db-stores.ts):
//   • NEVER-FAIL: every DB op is wrapped; nothing exported throws.
//   • DUAL-WRITE: saves go to BOTH Prisma and the legacy JSON file.
//   • Reads try DB first, fall back to JSON when the DB fails or
//     has no row while JSON has data.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `STATE_DB` is 'off'/'false'/'0', ALL prisma calls are
 * skipped — reads go straight to the JSON file, writes go only to JSON.
 * Mirrors the SNIPER_SEEN_DB pattern in db-seen-store.
 */
export function isStateDbDisabled(): boolean {
  const v = process.env.STATE_DB
  return v === 'off' || v === 'false' || v === '0'
}

// Scope → legacy JSON filename (dual-write backup target).
const SCOPE_JSON_FILE: Record<string, string> = {
  'feed-health-prev': 'feed-health-prev.json',
  'zero-issue-state': 'zero-issue-state.json',
  'whale-sheet-sync': 'whale-sheet-sync.json',
}

function jsonPathFor(scope: string): string | null {
  const file = SCOPE_JSON_FILE[scope]
  if (!file) return null
  return join(process.cwd(), 'data', file)
}

function readJsonBackup<T>(scope: string): T | null {
  const path = jsonPathFor(scope)
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJsonBackup(scope: string, data: unknown): void {
  const path = jsonPathFor(scope)
  if (!path) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error(`[db-state-meta] JSON backup write failed for ${scope}: ${errorMessage(err)}`)
  }
}

/**
 * Persist micro-meta for a scope. DB upsert first, then dual-write
 * the legacy JSON file. Never throws.
 */
export async function saveStateMeta(scope: string, data: unknown): Promise<void> {
  const payload = JSON.parse(JSON.stringify(data ?? null)) as Prisma.InputJsonValue
  if (!isStateDbDisabled()) {
    try {
      await prisma.stateMeta.upsert({
        where: { scope },
        create: { scope, data: payload },
        update: { data: payload },
      })
    } catch (err) {
      console.error(`[db-state-meta] saveStateMeta DB write failed for ${scope}: ${errorMessage(err)}`)
    }
  }
  writeJsonBackup(scope, data)
}

/**
 * Load micro-meta for a scope. DB first; JSON fallback when the DB
 * fails or has no row while JSON has data. Never throws.
 */
export async function loadStateMeta<T>(scope: string): Promise<T | null> {
  if (!isStateDbDisabled()) {
    try {
      const row = await prisma.stateMeta.findUnique({ where: { scope } })
      if (row) return row.data as T
    } catch (err) {
      console.error(`[db-state-meta] loadStateMeta DB read failed for ${scope}: ${errorMessage(err)}`)
    }
  }
  return readJsonBackup<T>(scope)
}
