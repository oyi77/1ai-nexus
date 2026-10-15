// ─────────────────────────────────────────────────────────────
// Wallet-buy signals — DB-primary store with automatic JSON fallback.
//
// Migrated 2026-10-16 (operator directive: prefer DB over JSON).
// `WalletBuySignal` (PostgreSQL via Prisma) is the PRIMARY store for
// tracked-wallet fresh buys (was data/wallet-buys-latest.json).
//
// This replaces the file-clobber race between wallet-refresh-cron /
// kol-monitor-cron (writers) and sniper-scan discoverWalletBuys /
// accumulation-alert-cron (readers). DB upserts by contract are atomic;
// the JSON file stays as a crash-safe dual-write backup.
//
// Invariants (mirrors db-delivery-store.ts / db-session-store.ts):
//   • NEVER-FAIL: every DB op is wrapped; nothing exported throws.
//   • DUAL-WRITE: saves go to BOTH Prisma and the legacy JSON file.
//   • Reads try DB first, fall back to JSON when the DB fails or
//     has no rows while JSON has data.
//   • Kill-switch WALLET_BUYS_DB=off skips ALL prisma calls (tests).
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `WALLET_BUYS_DB` is 'off'/'false'/'0', ALL prisma
 * calls are skipped — reads go straight to the JSON file, writes go only
 * to JSON, no errors logged. Used by tests to avoid polluting the live DB.
 */
export function isWalletBuysDbDisabled(): boolean {
  const v = process.env.WALLET_BUYS_DB
  return v === 'off' || v === 'false' || v === '0'
}

// ── Public row shape (stable across callers) ─────────────────

export interface WalletBuyRow {
  contract: string
  chain: string
  buyers: string[]
  buyVolumeUsd: number
  buyCount: number
  firstBuyAt: number | null
  lastBuyAt: number | null
}

// ── JSON artifact path (dual-write backup) ───────────────────

export function walletBuysJsonPath(): string {
  return (
    process.env.WALLET_BUYS_PATH ??
    join(process.cwd(), 'data', 'wallet-buys-latest.json')
  )
}

interface WalletBuyArtifact {
  generated_at: string
  min_usd: number
  window_min: number
  candidates: WalletBuyRow[]
}

function readJsonArtifact(): WalletBuyRow[] {
  try {
    const p = walletBuysJsonPath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8')) as WalletBuyArtifact
    if (!raw || !Array.isArray(raw.candidates)) return []
    return raw.candidates.filter(
      (c): c is WalletBuyRow =>
        typeof c?.contract === 'string' && Array.isArray(c.buyers),
    )
  } catch {
    return []
  }
}

function writeJsonArtifact(
  rows: WalletBuyRow[],
  source: string,
  windowMin: number,
): void {
  try {
    const p = walletBuysJsonPath()
    mkdirSync(dirname(p), { recursive: true })
    const payload: WalletBuyArtifact = {
      generated_at: new Date().toISOString(),
      min_usd: Number(process.env.WALLET_DISCOVERY_MIN_USD) || 2000,
      window_min: windowMin,
      candidates: rows,
    }
    writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
    void source // kept for log symmetry; not serialized into the artifact
  } catch (err) {
    console.error(`[db-wallet-buys] JSON write failed: ${errorMessage(err)}`)
  }
}

// ── Row mappers ──────────────────────────────────────────────

function toRow(input: WalletBuyRow, source: string): Prisma.WalletBuySignalUpsertArgs['create'] {
  return {
    contract: input.contract,
    chain: input.chain || 'solana',
    buyVolumeUsd: Number.isFinite(input.buyVolumeUsd) ? input.buyVolumeUsd : 0,
    buyCount: Number.isFinite(input.buyCount) ? input.buyCount : 0,
    firstBuyAt: input.firstBuyAt ? new Date(input.firstBuyAt) : null,
    lastBuyAt: input.lastBuyAt ? new Date(input.lastBuyAt) : null,
    buyers: input.buyers ?? [],
    source,
  }
}

function fromRow(row: {
  contract: string
  chain: string
  buyVolumeUsd: number
  buyCount: number
  firstBuyAt: Date | null
  lastBuyAt: Date | null
  buyers: Prisma.JsonValue
}): WalletBuyRow {
  const buyers = Array.isArray(row.buyers)
    ? (row.buyers.filter((b): b is string => typeof b === 'string'))
    : []
  return {
    contract: row.contract,
    chain: row.chain,
    buyers,
    buyVolumeUsd: row.buyVolumeUsd,
    buyCount: row.buyCount,
    firstBuyAt: row.firstBuyAt ? row.firstBuyAt.getTime() : null,
    lastBuyAt: row.lastBuyAt ? row.lastBuyAt.getTime() : null,
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Upsert wallet-buy candidates into the DB by contract, then mirror the
 * full set to the JSON artifact (dual-write). Callers that MERGE
 * (kol-monitor) should pass the merged set so the JSON stays consistent.
 *
 * `source` tags the writer (wallet-refresh | kol-monitor) for observability.
 * `windowMin` is serialized into the JSON artifact header.
 * Never throws.
 */
export async function saveWalletBuys(
  rows: WalletBuyRow[],
  source = 'wallet-refresh',
  windowMin = 60,
): Promise<void> {
  // Dual-write: JSON first (synchronous, so a concurrent reader never
  // sees a half-written DB state), then DB upserts.
  writeJsonArtifact(rows, source, windowMin)
  if (isWalletBuysDbDisabled() || rows.length === 0) return
  try {
    for (const input of rows) {
      const data = toRow(input, source)
      await prisma.walletBuySignal.upsert({
        where: { contract: input.contract },
        create: data,
        update: {
          buyVolumeUsd: data.buyVolumeUsd,
          buyCount: data.buyCount,
          firstBuyAt: data.firstBuyAt,
          lastBuyAt: data.lastBuyAt,
          buyers: data.buyers as Prisma.InputJsonValue,
          source: data.source,
        },
      })
    }
  } catch (err) {
    console.error(`[db-wallet-buys] DB upsert failed: ${errorMessage(err)}`)
  }
}

/**
 * Load wallet-buy candidates. DB first (newest by addedAt); JSON fallback
 * when the DB fails or has no rows while JSON has data. Never throws.
 *
 * Returns rows newest-first regardless of source.
 */
export async function loadWalletBuys(): Promise<WalletBuyRow[]> {
  if (isWalletBuysDbDisabled()) return readJsonArtifact()
  try {
    const dbRows = await prisma.walletBuySignal.findMany({
      orderBy: { addedAt: 'desc' },
    })
    if (dbRows.length > 0) return dbRows.map((r) => fromRow(r))
    return readJsonArtifact()
  } catch (err) {
    console.error(`[db-wallet-buys] DB read failed: ${errorMessage(err)}`)
    return readJsonArtifact()
  }
}

/**
 * Delete all rows older than `maxAgeMin`. Returns the deleted count, or -1
 * when the DB is unreachable. Never throws. The JSON artifact is NOT pruned
 * here (it is overwritten wholesale on the next saveWalletBuys pass).
 */
export async function pruneStaleWalletBuys(maxAgeMin = 120): Promise<number> {
  if (isWalletBuysDbDisabled()) return -1
  try {
    const cutoff = new Date(Date.now() - maxAgeMin * 60_000)
    const res = await prisma.walletBuySignal.deleteMany({
      where: { addedAt: { lt: cutoff } },
    })
    return res.count
  } catch (err) {
    console.error(`[db-wallet-buys] prune failed: ${errorMessage(err)}`)
    return -1
  }
}
