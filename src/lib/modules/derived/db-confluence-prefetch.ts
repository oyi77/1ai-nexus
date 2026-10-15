// ─────────────────────────────────────────────────────────────
// Confluence prefetch — DB-primary store with automatic JSON fallback.
//
// Migrated 2026-10-16 (operator directive: prefer DB over JSON).
// `ConfluencePrefetch` (PostgreSQL via Prisma) is the PRIMARY store for
// the smart-money confluence prefetch artifact (was
// data/confluence-latest.json).
//
// Written by confluence-cron via writeConfluenceArtifact; read by
// sniper-scan discoverConfluenceCandidates. This is a PREFETCH artifact
// (which tokens had confluence in the last window), NOT dedup state —
// the dedup side already lives in SniperReviewSeen.
//
// Invariants (mirrors db-session-store.ts):
//   • NEVER-FAIL: every DB op is wrapped; nothing exported throws.
//   • DUAL-WRITE: saves go to BOTH Prisma and the legacy JSON file.
//   • Reads try DB first, fall back to JSON when the DB fails or
//     has no rows while JSON has data.
//   • Kill-switch CONFLUENCE_PREFETCH_DB=off skips ALL prisma calls.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `CONFLUENCE_PREFETCH_DB` is 'off'/'false'/'0', ALL
 * prisma calls are skipped — reads go straight to the JSON file, writes go
 * only to JSON, no errors logged. Used by tests to avoid polluting the live DB.
 */
export function isConfluencePrefetchDbDisabled(): boolean {
  const v = process.env.CONFLUENCE_PREFETCH_DB
  return v === 'off' || v === 'false' || v === '0'
}

// ── Public row shape (stable across callers) ─────────────────

export interface ConfluencePrefetchRow {
  contract: string
  chain: string
  buyers: string[]
  totalBuyUsd: number
  firstBuyAt: number
  lastBuyAt: number
}

// ── JSON artifact path (dual-write backup) ───────────────────

export function confluencePrefetchJsonPath(): string {
  return (
    process.env.CONFLUENCE_LATEST_PATH ??
    join(process.cwd(), 'data', 'confluence-latest.json')
  )
}

interface ConfluenceArtifactFile {
  generated_at: string
  window_min: number
  signals: ConfluencePrefetchRow[]
}

function readJsonArtifact(nowMs: number, maxAgeMin: number): ConfluencePrefetchRow[] {
  try {
    const p = confluencePrefetchJsonPath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8')) as ConfluenceArtifactFile
    if (!raw || !Array.isArray(raw.signals)) return []
    const ageMin = (nowMs - Date.parse(raw.generated_at)) / 60_000
    if (!Number.isFinite(ageMin) || ageMin > maxAgeMin || ageMin < -5) return []
    return raw.signals.filter(
      (s): s is ConfluencePrefetchRow =>
        typeof s?.contract === 'string' && Array.isArray(s.buyers),
    )
  } catch {
    return []
  }
}

function writeJsonArtifact(
  rows: ConfluencePrefetchRow[],
  windowMin: number,
): string {
  const p = confluencePrefetchJsonPath()
  mkdirSync(dirname(p), { recursive: true })
  const payload: ConfluenceArtifactFile = {
    generated_at: new Date().toISOString(),
    window_min: windowMin,
    signals: rows,
  }
  writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
  return p
}

// ── Row mappers ──────────────────────────────────────────────

function toRow(input: ConfluencePrefetchRow): Prisma.ConfluencePrefetchUpsertArgs['create'] {
  return {
    contract: input.contract,
    chain: input.chain || 'solana',
    signals: {
      buyers: input.buyers,
      totalBuyUsd: input.totalBuyUsd,
      firstBuyAt: input.firstBuyAt,
      lastBuyAt: input.lastBuyAt,
    } as Prisma.InputJsonValue,
  }
}

function fromRow(row: {
  contract: string
  chain: string
  signals: Prisma.JsonValue
}): ConfluencePrefetchRow {
  const sig = (row.signals ?? {}) as Record<string, unknown>
  const buyers = Array.isArray(sig.buyers)
    ? sig.buyers.filter((b): b is string => typeof b === 'string')
    : []
  return {
    contract: row.contract,
    chain: row.chain,
    buyers,
    totalBuyUsd: typeof sig.totalBuyUsd === 'number' ? sig.totalBuyUsd : 0,
    firstBuyAt: typeof sig.firstBuyAt === 'number' ? sig.firstBuyAt : 0,
    lastBuyAt: typeof sig.lastBuyAt === 'number' ? sig.lastBuyAt : 0,
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Upsert confluence prefetch signals into the DB by contract, then mirror
 * to the JSON artifact (dual-write). `windowMin` is serialized into the
 * JSON artifact header for the staleness gate on read. Never throws.
 */
export async function saveConfluencePrefetch(
  rows: ConfluencePrefetchRow[],
  windowMin = 15,
): Promise<string | null> {
  if (rows.length === 0) return null
  // Dual-write: JSON first (synchronous), then DB upserts.
  const path = writeJsonArtifact(rows, windowMin)
  if (isConfluencePrefetchDbDisabled()) return path
  try {
    for (const input of rows) {
      const data = toRow(input)
      await prisma.confluencePrefetch.upsert({
        where: { contract: input.contract },
        create: data,
        update: {
          chain: data.chain,
          signals: data.signals,
        },
      })
    }
  } catch (err) {
    console.error(`[db-confluence-prefetch] DB upsert failed: ${errorMessage(err)}`)
  }
  return path
}

/**
 * Load confluence prefetch signals. DB first; JSON fallback when the DB
 * fails or has no rows while JSON has data. Applies the same staleness
 * gate as the legacy JSON reader (>maxAgeMin → empty). Never throws.
 */
export async function loadConfluencePrefetch(
  nowMs = Date.now(),
  maxAgeMin = Number(process.env.CONFLUENCE_MAX_AGE_MIN) || 120,
): Promise<ConfluencePrefetchRow[]> {
  if (isConfluencePrefetchDbDisabled()) return readJsonArtifact(nowMs, maxAgeMin)
  try {
    // Prune stale rows so the DB never grows without bound.
    const cutoff = new Date(nowMs - maxAgeMin * 60_000)
    const dbRows = await prisma.confluencePrefetch.findMany({
      where: { updatedAt: { gte: cutoff } },
      orderBy: { updatedAt: 'desc' },
    })
    if (dbRows.length > 0) return dbRows.map((r) => fromRow(r))
    return readJsonArtifact(nowMs, maxAgeMin)
  } catch (err) {
    console.error(`[db-confluence-prefetch] DB read failed: ${errorMessage(err)}`)
    return readJsonArtifact(nowMs, maxAgeMin)
  }
}
