#!/usr/bin/env node
// -------------------------------------------------------------
// One-time backfill: JSON ring buffers → DB-primary tables.
//
// Reads the legacy JSON artifacts and inserts rows into:
//   - SniperScanDecision  (from data/sniper-log.json)
//   - SniperAuditEntry    (from data/sniper-audit.json)
//   - SniperSignalOutcome (from data/sniper-outcomes.json)
//
// Idempotent-ish: uses createMany (no unique conflict guard beyond the
// PK). Re-running will duplicate rows, so run once. Prints before/after
// counts so the operator can verify the seed.
//
// Run: npx tsx scripts/backfill-sniper-db.ts
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

interface LegacyLogEntry {
  contract?: string
  ticker?: string
  status?: string
  tier?: string
  delivered?: boolean
  deduped?: boolean
  rejections?: string[]
  warnings?: string[]
  metrics?: Record<string, unknown>
  market?: { marketCapUsd?: number | null; liquidityUsd?: number | null }
  at?: string
  discoveryCategory?: string
}

interface LegacyAuditEntry {
  contract: string
  at: string
  status: string
  tier: string
  delivered: boolean
  deduped: boolean
  change: string
  rejectionCount: number
  previousStatus?: string | null
  marketCapUsd?: number | null
  liquidityUsd?: number | null
  distribution?: Record<string, unknown> | null
}

interface LegacyOutcomeLog {
  signals?: Array<{
    contract: string
    ticker?: string
    tier?: string
    verdict?: string
    deliveredAt?: string
    entryMarketCapUsd?: number | null
    exitMarketCapUsd?: number | null
    returnPct?: number | null
    rejections?: string[]
    warnings?: string[]
    market?: { marketCapUsd?: number | null; liquidityUsd?: number | null }
  }>
}

async function main() {
  const logPath = join(process.cwd(), 'data', 'sniper-log.json')
  const auditPath = join(process.cwd(), 'data', 'sniper-audit.json')
  const outcomesPath = join(process.cwd(), 'data', 'sniper-outcomes.json')

  const beforeScan = await prisma.sniperScanDecision.count()
  const beforeAudit = await prisma.sniperAuditEntry.count()
  const beforeOutcome = await prisma.sniperSignalOutcome.count()

  console.log('[backfill] before: scan=%d audit=%d outcome=%d', beforeScan, beforeAudit, beforeOutcome)

  // 1. SniperScanDecision
  const logJson = readJson<{ entries?: LegacyLogEntry[] }>(logPath)
  if (logJson?.entries && logJson.entries.length > 0) {
    const rows: Prisma.SniperScanDecisionCreateManyInput[] = logJson.entries
      .filter((e) => typeof e?.contract === 'string' && e.contract.length > 0)
      .map((e) => {
        const at = Number.isFinite(Date.parse(e.at ?? '')) ? new Date(e.at!) : new Date()
        return {
          contract: e.contract!,
          chain: SNIPER_CHAIN,
          symbol: e.ticker ?? '',
          name: e.ticker ?? '',
          status: e.status ?? 'REJECT',
          stage: (e.metrics?.stage as string | null) ?? null,
          tier: e.tier ?? null,
          reasons: e.rejections ?? [],
          metrics: JSON.parse(JSON.stringify(e.metrics ?? {})) as Prisma.InputJsonValue,
          scores: undefined,
          source: e.discoveryCategory ?? null,
          delivered: e.delivered ?? false,
          deliveryTier: e.delivered ? e.tier : null,
          scannedAt: at,
          metadata: JSON.parse(JSON.stringify(e)) as Prisma.InputJsonValue,
        }
      })
    if (rows.length > 0) {
      const r = await prisma.sniperScanDecision.createMany({ data: rows })
      console.log('[backfill] scan decisions: inserted %d rows', r.count)
    }
  } else {
    console.log('[backfill] sniper-log.json missing or empty — skipping scan decisions')
  }

  // 2. SniperAuditEntry
  const auditJson = readJson<{ entries?: LegacyAuditEntry[] }>(auditPath)
  if (auditJson?.entries && auditJson.entries.length > 0) {
    const rows: Prisma.SniperAuditEntryCreateManyInput[] = auditJson.entries
      .filter((e) => typeof e?.contract === 'string' && e.contract.length > 0)
      .map((e) => {
        const at = Number.isFinite(Date.parse(e.at)) ? new Date(e.at) : new Date()
        return {
          contract: e.contract,
          chain: SNIPER_CHAIN,
          symbol: '',
          status: e.status,
          tier: e.tier,
          delivered: e.delivered,
          deduped: e.deduped,
          change: e.change,
          rejectionCount: e.rejectionCount,
          previousStatus: e.previousStatus ?? null,
          marketCapUsd: e.marketCapUsd ?? null,
          liquidityUsd: e.liquidityUsd ?? null,
          distribution:
            e.distribution === null || e.distribution === undefined
              ? undefined
              : (JSON.parse(JSON.stringify(e.distribution)) as Prisma.InputJsonValue),
          observedAt: at,
        }
      })
    if (rows.length > 0) {
      const r = await prisma.sniperAuditEntry.createMany({ data: rows })
      console.log('[backfill] audit entries: inserted %d rows', r.count)
    }
  } else {
    console.log('[backfill] sniper-audit.json missing or empty — skipping audit entries')
  }

  // 3. SniperSignalOutcome
  const outcomesJson = readJson<LegacyOutcomeLog>(outcomesPath)
  if (outcomesJson?.signals && outcomesJson.signals.length > 0) {
    const rows: Prisma.SniperSignalOutcomeCreateManyInput[] = outcomesJson.signals
      .filter((s) => typeof s?.contract === 'string' && s.contract.length > 0)
      .map((s, idx) => {
        const deliveredAt = Number.isFinite(Date.parse(s.deliveredAt ?? '')) ? new Date(s.deliveredAt!) : new Date()
        return {
          signalId: `${s.contract}:${deliveredAt.getTime()}:${idx}`,
          contract: s.contract,
          chain: SNIPER_CHAIN,
          symbol: s.ticker ?? '',
          source: 'sniper',
          stage: 'MEME',
          tier: s.tier ?? null,
          status: s.verdict ?? 'PENDING',
          verdict: s.verdict ?? 'PENDING',
          alertedAt: deliveredAt,
          horizonHours: 24,
          currentMcapUsd: s.entryMarketCapUsd ?? null,
          roiPct: s.returnPct ?? null,
          returnPct: s.returnPct ?? null,
          entryMarketCapUsd: s.entryMarketCapUsd ?? null,
          exitMarketCapUsd: s.exitMarketCapUsd ?? null,
          profileIds: [],
          profileBreaches: [],
        }
      })
    if (rows.length > 0) {
      const r = await prisma.sniperSignalOutcome.createMany({ data: rows })
      console.log('[backfill] signal outcomes: inserted %d rows', r.count)
    }
  } else {
    console.log('[backfill] sniper-outcomes.json missing or empty — skipping signal outcomes')
  }

  const afterScan = await prisma.sniperScanDecision.count()
  const afterAudit = await prisma.sniperAuditEntry.count()
  const afterOutcome = await prisma.sniperSignalOutcome.count()

  console.log('[backfill] after:  scan=%d audit=%d outcome=%d', afterScan, afterAudit, afterOutcome)
  console.log('[backfill] delta:  scan=%+d audit=%+d outcome=%+d', afterScan - beforeScan, afterAudit - beforeAudit, afterOutcome - beforeOutcome)
  console.log('[backfill] done.')
  process.exit(0)
}

main().catch((e) => {
  console.error('[backfill] FATAL:', e)
  process.exit(1)
})
