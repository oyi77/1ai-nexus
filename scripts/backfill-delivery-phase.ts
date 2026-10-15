#!/usr/bin/env node
// -------------------------------------------------------------
// One-time backfill: JSON ring buffers → DB-primary tables.
//
// Reads the legacy JSON artifacts and inserts rows into:
//   - SniperDeliveryLog (from data/sniper-delivery-log.json)
//   - SniperPhase       (from data/sniper-phase.json)
//
// Idempotent: uses upsert by unique key (deliveryKey / contract), so
// re-running updates existing rows rather than duplicating.
// Prints before/after counts so the operator can verify the seed.
//
// Run: npx tsx scripts/backfill-delivery-phase.ts
// -------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { SNIPER_CHAIN } from '@/lib/modules/derived/db-stores'
import type { Prisma } from '@prisma/client'

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

interface LegacyDeliveryEntry {
  at: string
  chatId: string | null
  contract: string | null
  messageTextPrefix: string
  ok: boolean
  status: number | null
  error: string | null
  attemptCount: number
  truncated: boolean
}

interface LegacyDeliveryLog {
  entries: LegacyDeliveryEntry[]
  updatedAt: string | null
}

interface LegacyPhaseEntry {
  contract: string
  at: string
  phase: string
  score: number
  readings: number
  reason: string | null
}

interface LegacyPhaseLog {
  entries: LegacyPhaseEntry[]
  updatedAt: string | null
}

async function backfillDelivery(): Promise<void> {
  const path = join(process.cwd(), 'data', 'sniper-delivery-log.json')
  const before = await prisma.sniperDeliveryLog.count()
  console.log('[backfill] delivery: before=%d', before)

  const json = readJson<LegacyDeliveryLog>(path)
  if (!json?.entries || json.entries.length === 0) {
    console.log('[backfill] sniper-delivery-log.json missing or empty — skipping')
    return
  }

  // Deduplicate by deliveryKey (keep the first/newest occurrence).
  const seen = new Set<string>()
  let inserted = 0
  for (const e of json.entries) {
    const c = e.contract ?? 'none'
    const deliveryKey = `${c}:${e.at}`
    if (seen.has(deliveryKey)) continue
    seen.add(deliveryKey)

    const deliveredAt = Number.isFinite(Date.parse(e.at)) ? new Date(e.at) : new Date()
    const row: Prisma.SniperDeliveryLogUpsertArgs = {
      where: { deliveryKey },
      create: {
        deliveryKey,
        contract: e.contract ?? null,
        chain: SNIPER_CHAIN,
        chatId: e.chatId ?? null,
        messageTextPrefix: e.messageTextPrefix,
        ok: e.ok,
        status: e.status,
        error: e.error,
        attemptCount: e.attemptCount,
        truncated: e.truncated,
        deliveredAt,
      },
      update: {
        contract: e.contract ?? null,
        chatId: e.chatId ?? null,
        messageTextPrefix: e.messageTextPrefix,
        ok: e.ok,
        status: e.status,
        error: e.error,
        attemptCount: e.attemptCount,
        truncated: e.truncated,
        deliveredAt,
      },
    }
    try {
      await prisma.sniperDeliveryLog.upsert(row)
      inserted += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[backfill] delivery upsert failed for ${deliveryKey}: ${msg}`)
    }
  }

  const after = await prisma.sniperDeliveryLog.count()
  console.log('[backfill] delivery: inserted=%d after=%d (delta=+%d)', inserted, after, after - before)
}

async function backfillPhase(): Promise<void> {
  const path = join(process.cwd(), 'data', 'sniper-phase.json')
  const before = await prisma.sniperPhase.count()
  console.log('[backfill] phase: before=%d', before)

  const json = readJson<LegacyPhaseLog>(path)
  if (!json?.entries || json.entries.length === 0) {
    console.log('[backfill] sniper-phase.json missing or empty — skipping')
    return
  }

  // Deduplicate by contract (keep the newest entry per contract).
  const latestByContract = new Map<string, LegacyPhaseEntry>()
  for (const e of json.entries) {
    const existing = latestByContract.get(e.contract)
    if (!existing || Date.parse(e.at) > Date.parse(existing.at)) {
      latestByContract.set(e.contract, e)
    }
  }

  let inserted = 0
  for (const e of latestByContract.values()) {
    const at = Number.isFinite(Date.parse(e.at)) ? new Date(e.at) : new Date()
    const row: Prisma.SniperPhaseUpsertArgs = {
      where: { contract: e.contract },
      create: {
        contract: e.contract,
        chain: SNIPER_CHAIN,
        phase: e.phase,
        score: e.score,
        readings: e.readings,
        reason: e.reason,
        at,
      },
      update: {
        phase: e.phase,
        score: e.score,
        readings: e.readings,
        reason: e.reason,
        at,
      },
    }
    try {
      await prisma.sniperPhase.upsert(row)
      inserted += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[backfill] phase upsert failed for ${e.contract}: ${msg}`)
    }
  }

  const after = await prisma.sniperPhase.count()
  console.log('[backfill] phase: inserted=%d after=%d (delta=+%d)', inserted, after, after - before)
}

async function main() {
  console.log('[backfill] starting delivery + phase backfill')
  await backfillDelivery()
  await backfillPhase()
  console.log('[backfill] done.')
  process.exit(0)
}

main().catch((e) => {
  console.error('[backfill] FATAL:', e)
  process.exit(1)
})
