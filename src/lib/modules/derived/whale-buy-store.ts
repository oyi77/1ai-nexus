// ─────────────────────────────────────────────────────────────
// Whale-buy scanner store — DB-primary + JSON dual-write.
//
// Writes whale-sized buy detections into the `WalletBuySignal` table
// (PostgreSQL via Prisma) with source='whale-buy-scanner', and mirrors
// the full set to data/whale-buys-latest.json as a crash-safe backup.
//
// Mirrors db-wallet-buys.ts invariants:
//   • NEVER-FAIL: every DB op is wrapped; nothing exported throws.
//   • DUAL-WRITE: saves go to BOTH Prisma and the JSON file.
//   • Reads try DB first (source='whale-buy-scanner'), fall back to JSON
//     when the DB fails or has no rows while JSON has data.
//   • Kill-switch WHALE_BUYS_DB=off skips ALL prisma calls (tests).
//
// Uses the same WalletBuySignal model as db-wallet-buys.ts, keyed by
// contract @unique. The `source` field distinguishes the two writers
// (wallet-refresh vs whale-buy-scanner) so consumers can filter.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

const SOURCE = 'whale-buy-scanner'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `WHALE_BUYS_DB` is 'off'/'false'/'0', ALL prisma
 * calls are skipped — reads go straight to the JSON file, writes go only
 * to JSON, no errors logged. Used by tests to avoid polluting the live DB.
 */
export function isWhaleBuysDbDisabled(): boolean {
  const v = process.env.WHALE_BUYS_DB
  return v === 'off' || v === 'false' || v === '0'
}

// ── Public row shape ─────────────────────────────────────────

export interface WhaleBuyRow {
  contract: string
  chain: string
  buyers: string[]
  buyVolumeUsd: number
  buyCount: number
  firstBuyAt: number | null
  lastBuyAt: number | null
}

// ── JSON artifact path (dual-write backup) ───────────────────

export function whaleBuysJsonPath(): string {
  return (
    process.env.WHALE_BUYS_PATH ??
    join(process.cwd(), 'data', 'whale-buys-latest.json')
  )
}

interface WhaleBuyArtifact {
  generated_at: string
  source: string
  candidates: WhaleBuyRow[]
}

function readJsonArtifact(): WhaleBuyRow[] {
  try {
    const p = whaleBuysJsonPath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8')) as WhaleBuyArtifact
    if (!raw || !Array.isArray(raw.candidates)) return []
    return raw.candidates.filter(
      (c): c is WhaleBuyRow =>
        typeof c?.contract === 'string' && Array.isArray(c.buyers),
    )
  } catch {
    return []
  }
}

function writeJsonArtifact(rows: WhaleBuyRow[]): void {
  try {
    const p = whaleBuysJsonPath()
    mkdirSync(dirname(p), { recursive: true })
    const payload: WhaleBuyArtifact = {
      generated_at: new Date().toISOString(),
      source: SOURCE,
      candidates: rows,
    }
    writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    console.error(`[whale-buy-store] JSON write failed: ${errorMessage(err)}`)
  }
}

// ── Row mappers ──────────────────────────────────────────────

function toPrismaRow(input: WhaleBuyRow): Prisma.WalletBuySignalUpsertArgs['create'] {
  return {
    contract: input.contract,
    chain: input.chain || 'solana',
    buyVolumeUsd: Number.isFinite(input.buyVolumeUsd) ? input.buyVolumeUsd : 0,
    buyCount: Number.isFinite(input.buyCount) ? input.buyCount : 0,
    firstBuyAt: input.firstBuyAt ? new Date(input.firstBuyAt) : null,
    lastBuyAt: input.lastBuyAt ? new Date(input.lastBuyAt) : null,
    buyers: input.buyers ?? [],
    source: SOURCE,
  }
}

function fromDbRow(row: {
  contract: string
  chain: string
  buyVolumeUsd: number
  buyCount: number
  firstBuyAt: Date | null
  lastBuyAt: Date | null
  buyers: Prisma.JsonValue
}): WhaleBuyRow {
  const buyers = Array.isArray(row.buyers)
    ? row.buyers.filter((b): b is string => typeof b === 'string')
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
 * Upsert whale-buy detections into the DB by contract (source=
 * 'whale-buy-scanner'), then mirror the full set to the JSON artifact.
 * Never throws.
 */
export async function saveWhaleBuys(rows: WhaleBuyRow[]): Promise<void> {
  // Merge into the artifact instead of overwriting it: callers pass only the
  // rows that are NEW this pass, so a plain overwrite would drop every
  // candidate found earlier and leave the JSON a partial view of the DB.
  const byContract = new Map<string, WhaleBuyRow>()
  for (const existing of readJsonArtifact()) byContract.set(existing.contract, existing)
  for (const row of rows) byContract.set(row.contract, row)
  writeJsonArtifact([...byContract.values()])
  if (isWhaleBuysDbDisabled() || rows.length === 0) return
  try {
    for (const input of rows) {
      const data = toPrismaRow(input)
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
    console.error(`[whale-buy-store] DB upsert failed: ${errorMessage(err)}`)
  }
}

/**
 * Load whale-buy candidates. DB first (source='whale-buy-scanner',
 * newest by addedAt); JSON fallback when the DB fails or has no rows.
 * Never throws. Returns rows newest-first.
 */
export async function loadWhaleBuys(): Promise<WhaleBuyRow[]> {
  if (isWhaleBuysDbDisabled()) return readJsonArtifact()
  try {
    const dbRows = await prisma.walletBuySignal.findMany({
      where: { source: SOURCE },
      orderBy: { addedAt: 'desc' },
    })
    if (dbRows.length > 0) return dbRows.map((r) => fromDbRow(r))
    return readJsonArtifact()
  } catch (err) {
    console.error(`[whale-buy-store] DB read failed: ${errorMessage(err)}`)
    return readJsonArtifact()
  }
}

/**
 * Delete all whale-buy-scanner rows older than `maxAgeMin`. Returns the
 * deleted count, or -1 when the DB is unreachable. Never throws.
 */
export async function pruneStaleWhaleBuys(maxAgeMin = 360): Promise<number> {
  if (isWhaleBuysDbDisabled()) return -1
  try {
    const cutoff = new Date(Date.now() - maxAgeMin * 60_000)
    const res = await prisma.walletBuySignal.deleteMany({
      where: { source: SOURCE, addedAt: { lt: cutoff } },
    })
    return res.count
  } catch (err) {
    console.error(`[whale-buy-store] prune failed: ${errorMessage(err)}`)
    return -1
  }
}
