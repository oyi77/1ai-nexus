// ─────────────────────────────────────────────────────────────
// Meme Sniper — DB-primary phase store with JSON fallback.
//
// `SniperPhase` (PostgreSQL via Prisma) is the PRIMARY store for per-contract
// accumulation phase verdicts (was data/sniper-phase.json).
//
// Invariants (identical to db-stores.ts / db-seen-store.ts):
//   • NEVER-FAIL: every DB write is wrapped; a DB outage must never break a
//     scan pass or cron. When DB write fails, the JSON file is still written
//     (by the caller — persistAccumulationPhases does its own writePhaseLog).
//   • DUAL-WRITE: persistAccumulationPhases writes the JSON ring buffer via
//     its own writePhaseLog, THEN calls savePhaseStates for the DB upsert.
//     This module is the DB persistence layer only; JSON is managed by
//     sniper-phase.ts.
//   • Reads try DB first and fall back to JSON when the DB fails or returns
//     empty while JSON has data.
//   • KILL-SWITCH: when SNIPER_PHASE_DB is 'off'/'false'/'0', all prisma
//     calls are skipped — reads go straight to JSON. Used by tests to avoid
//     polluting the live DB.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  readSniperPhaseLog,
  type SniperPhaseEntry,
  type SniperPhaseLog,
} from './sniper-phase'

export { type SniperPhaseEntry, type SniperPhaseLog }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Kill-switch: when `SNIPER_PHASE_DB` is 'off'/'false'/'0', ALL prisma
 * calls are skipped — reads go straight to the JSON file. Used by tests
 * to avoid polluting the live DB.
 */
export function isPhaseDbDisabled(): boolean {
  const v = process.env.SNIPER_PHASE_DB
  return v === 'off' || v === 'false' || v === '0'
}

const CHAIN = 'solana'

function toPhaseRow(
  entry: SniperPhaseEntry,
): Prisma.SniperPhaseCreateInput {
  const at = Number.isFinite(Date.parse(entry.at)) ? new Date(entry.at) : new Date()
  return {
    contract: entry.contract,
    chain: CHAIN,
    phase: entry.phase,
    score: entry.score,
    readings: entry.readings,
    reason: entry.reason,
    at,
  }
}

function fromPhaseRow(row: {
  contract: string
  phase: string
  score: number
  readings: number
  reason: string | null
  at: Date
}): SniperPhaseEntry {
  return {
    contract: row.contract,
    at: row.at.toISOString(),
    phase: row.phase as SniperPhaseEntry['phase'],
    score: row.score,
    readings: row.readings,
    reason: row.reason,
  }
}

/**
 * Upsert phase states into the DB by contract (one row per contract,
 * latest verdict). This is the DB persistence layer only — the JSON ring
 * buffer is managed by the caller (persistAccumulationPhases does its own
 * writePhaseLog). Never throws.
 */
export async function savePhaseStates(
  entries: SniperPhaseEntry[],
): Promise<void> {
  if (entries.length === 0) return
  if (isPhaseDbDisabled()) return
  for (const entry of entries) {
    try {
      await prisma.sniperPhase.upsert({
        where: { contract: entry.contract },
        create: toPhaseRow(entry),
        update: toPhaseRow(entry),
      })
    } catch (err) {
      // NEVER-FAIL: a bad row must not break the rest of the sweep.
      console.error(
        `[db-phase-store] savePhaseStates DB write failed for ${entry.contract}: ${errorMessage(err)}`,
      )
    }
  }
}

/**
 * Load phase states from the DB, optionally filtered by contract list.
 * DB first; JSON fallback when the DB fails or has no rows while JSON
 * has data. Returns newest-first by `at`. Never throws.
 */
export async function loadPhaseStates(
  contracts?: string[],
): Promise<SniperPhaseEntry[]> {
  if (isPhaseDbDisabled()) {
    return filterJsonPhase(contracts)
  }
  try {
    const rows = await prisma.sniperPhase.findMany({
      where:
        contracts !== undefined && contracts.length > 0
          ? { contract: { in: contracts } }
          : undefined,
      orderBy: { at: 'desc' },
    })
    if (rows.length > 0) return rows.map(fromPhaseRow)
    return filterJsonPhase(contracts)
  } catch (err) {
    console.error(
      `[db-phase-store] loadPhaseStates DB read failed: ${errorMessage(err)}`,
    )
    return filterJsonPhase(contracts)
  }
}

function filterJsonPhase(contracts?: string[]): SniperPhaseEntry[] {
  const json = readSniperPhaseLog().entries
  return contracts !== undefined
    ? json.filter((e) => contracts.includes(e.contract))
    : json
}

/**
 * Load the full phase log (entries + updatedAt). DB first; JSON fallback.
 * Never throws.
 */
export async function loadPhaseLog(): Promise<SniperPhaseLog> {
  const entries = await loadPhaseStates()
  return {
    entries,
    updatedAt: entries.length > 0 ? entries[0].at : null,
  }
}
