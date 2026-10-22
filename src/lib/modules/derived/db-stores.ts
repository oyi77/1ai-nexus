// ─────────────────────────────────────────────────────────────
// Meme Sniper — DB-primary stores with automatic JSON fallback.
//
// The operator approved making PostgreSQL (via Prisma) the PRIMARY
// persistence layer for the three sniper state tables:
//   • SniperScanDecision   (was data/sniper-log.json)
//   • SniperAuditEntry     (was data/sniper-audit.json)
//   • SniperSignalOutcome  (was data/sniper-outcomes.json)
//
// Invariants:
//   • NEVER-FAIL: every DB write is wrapped; a DB outage must never break a
//     scan pass or cron. When DB write fails, the JSON file is still written.
//   • DUAL-WRITE: while other scripts/tests still read JSON, every write
//     goes to BOTH Prisma and the legacy JSON file (best-effort).
//   • Reads try DB first and fall back to JSON when the DB fails or returns
//     empty while JSON has data.
//
// The legacy `readSniperLog`/`appendSniperScan`/… functions remain the
// synchronous JSON path (used by tests and a few sync callers). Production
// callers use the async functions in this module.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { appendSniperScan, readSniperLog, type SniperLogEntry } from './sniper-log'
import { appendAuditEntries, readSniperAudit, type AuditEntry } from './sniper-audit'
import { readOutcomes, writeOutcomes, type OutcomeLog, type SignalOutcome } from './sniper-outcomes'
import type { SniperScanDecision } from './sniper-scan'

export const SNIPER_CHAIN = 'solana'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ─────────────────────────────────────────────────────────────
// Scan decisions (data/sniper-log.json → SniperScanDecision)
// ─────────────────────────────────────────────────────────────

type ScanMeta = {
  scanned?: number
  screened?: number
  watchlisted?: number
  rejected?: number
  delivered?: number
  errors?: string[]
}

function resultLike(decisions: SniperScanDecision[], meta?: ScanMeta) {
  return {
    decisions,
    scanned: meta?.scanned ?? decisions.length,
    screened: meta?.screened ?? decisions.filter((d) => d.status === 'SIGNAL').length,
    watchlisted: meta?.watchlisted ?? decisions.filter((d) => d.status === 'WATCHLIST').length,
    rejected: meta?.rejected ?? decisions.filter((d) => d.status === 'REJECT').length,
    delivered: meta?.delivered ?? decisions.filter((d) => d.delivered).length,
    errors: meta?.errors ?? [],
  }
}

function toScanDecisionRow(entry: SniperLogEntry, scannedAt: Date): Prisma.SniperScanDecisionCreateManyInput {
  return {
    contract: entry.contract,
    chain: SNIPER_CHAIN,
    symbol: entry.ticker,
    name: entry.ticker,
    status: entry.status,
    stage: entry.metrics?.stage ?? null,
    tier: entry.tier ?? null,
    reasons: entry.rejections ?? [],
    metrics: JSON.parse(JSON.stringify(entry.metrics ?? {})) as Prisma.InputJsonValue,
    scores: undefined,
    source: entry.discoveryCategory ?? null,
    delivered: entry.delivered ?? false,
    deliveryTier: entry.delivered ? entry.tier : null,
    scannedAt,
    metadata: JSON.parse(JSON.stringify(entry)) as Prisma.InputJsonValue,
  }
}

function fromScanDecisionRow(row: {
  metadata?: Prisma.JsonValue | null
  contract: string
  chain: string
  symbol: string
  name: string
  status: string
  stage: string | null
  tier: string | null
  reasons: string[]
  metrics: Prisma.JsonValue
  scores?: Prisma.JsonValue | null
  source: string | null
  delivered: boolean
  deliveryTier: string | null
  scannedAt: Date
}): SniperLogEntry {
  const meta = row.metadata
  if (meta !== null && meta !== undefined && typeof meta === 'object' && !Array.isArray(meta)) {
    const candidate = meta as Partial<SniperLogEntry>
    if (typeof candidate.contract === 'string' && typeof candidate.ticker === 'string') {
      return candidate as SniperLogEntry
    }
  }
  // Reconstruct the minimal domain entry for rows written by other systems.
  const metrics = (row.metrics ?? {}) as Record<string, unknown>
  return {
    status: row.status as SniperLogEntry['status'],
    rationale: '',
    rejections: row.reasons ?? [],
    warnings: [],
    metrics: {
      stage: (metrics.stage as SniperLogEntry['metrics']['stage']) ?? 'new-pair',
      ageMinutes: (metrics.ageMinutes as number) ?? 0,
      ageLabel: (metrics.ageLabel as string) ?? 'unknown',
      stageLabel: (metrics.stageLabel as string) ?? 'unknown',
      volMcRatio: typeof metrics.volMcRatio === 'number' && Number.isFinite(metrics.volMcRatio) ? metrics.volMcRatio : null,
      requiredRatio: (metrics.requiredRatio as number) ?? 0,
      devPercent: (metrics.devPercent as number | null) ?? null,
      sniperPercent: (metrics.sniperPercent as number | null) ?? null,
      bundlerPercent: (metrics.bundlerPercent as number | null) ?? null,
      insiderPercent: (metrics.insiderPercent as number | null) ?? null,
      top10Percent: (metrics.top10Percent as number | null) ?? null,
      clusterPercent: (metrics.clusterPercent as number | null) ?? null,
      avgPnlPercent: (metrics.avgPnlPercent as number | null) ?? null,
      pnlAssessment: (metrics.pnlAssessment as SniperLogEntry['metrics']['pnlAssessment']) ?? 'neutral',
    },
    contract: row.contract,
    ticker: row.symbol || row.name,
    deduped: false,
    delivered: row.delivered,
    auditsUsed: [],
    tier: (row.tier as SniperLogEntry['tier']) ?? 'REJECT',
    tierReasons: [],
    tierMissing: [],
    smartMoneyBuyers: 0,
    smartMoneyStrongest: null,
    smartMoneySource: 'none',
    discoveryCategory: (row.source as SniperLogEntry['discoveryCategory']) ?? 'NEW_PAIRS',
    discoveryEvidence: [],
    market: { marketCapUsd: null, liquidityUsd: null, volume5mUsd: null, priceUsd: null },
  }
}

/**
 * Persist one scan pass. DB first (append-only; the ring buffer cap is
 * enforced by the JSON file and by `take` on reads). Never throws.
 */
export async function saveScanDecisions(decisions: SniperScanDecision[], meta?: ScanMeta): Promise<void> {
  const scannedAt = new Date()
  try {
    if (decisions.length > 0) {
      const rows = decisions
        .map(({ alert: _alert, ...rest }) => rest)
        .map((entry) => toScanDecisionRow(entry, scannedAt))
      await prisma.sniperScanDecision.createMany({ data: rows })
    }
  } catch (err) {
    // NEVER-FAIL: DB outage falls through to the JSON backup below.
    console.error(`[db-stores] saveScanDecisions DB write failed: ${errorMessage(err)}`)
  }
  try {
    appendSniperScan(resultLike(decisions, meta))
  } catch (err) {
    console.error(`[db-stores] saveScanDecisions JSON write failed: ${errorMessage(err)}`)
  }
}

/**
 * Latest decisions, DB first. Falls back to the JSON ring buffer when the DB
 * fails or has no rows while JSON has data.
 */
export async function loadRecentDecisions(limit = 200): Promise<SniperLogEntry[]> {
  try {
    const rows = await prisma.sniperScanDecision.findMany({
      orderBy: { scannedAt: 'desc' },
      take: limit,
    })
    if (rows.length > 0) return rows.map((row) => fromScanDecisionRow(row))
    const json = readSniperLog().entries
    return json.slice(0, limit)
  } catch (err) {
    console.error(`[db-stores] loadRecentDecisions DB read failed: ${errorMessage(err)}`)
    return readSniperLog().entries.slice(0, limit)
  }
}

// ─────────────────────────────────────────────────────────────
// Audit trail (data/sniper-audit.json → SniperAuditEntry)
// ─────────────────────────────────────────────────────────────

function toAuditRow(entry: AuditEntry): Prisma.SniperAuditEntryCreateManyInput {
  const at = Number.isFinite(Date.parse(entry.at)) ? new Date(entry.at) : new Date()
  return {
    contract: entry.contract,
    chain: SNIPER_CHAIN,
    status: entry.status,
    tier: entry.tier,
    delivered: entry.delivered,
    deduped: entry.deduped,
    change: entry.change,
    rejectionCount: entry.rejectionCount,
    previousStatus: entry.previousStatus,
    marketCapUsd: entry.marketCapUsd,
    liquidityUsd: entry.liquidityUsd,
    distribution: entry.distribution === null || entry.distribution === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(entry.distribution)) as Prisma.InputJsonValue),
    observedAt: at,
  }
}

function fromAuditRow(row: {
  contract: string
  status: string | null
  tier: string | null
  delivered: boolean | null
  deduped: boolean | null
  change: string | null
  rejectionCount: number | null
  previousStatus: string | null
  marketCapUsd: number | null
  liquidityUsd: number | null
  distribution: Prisma.JsonValue | null
  observedAt: Date
}): AuditEntry {
  const dist = row.distribution
  return {
    contract: row.contract,
    at: row.observedAt.toISOString(),
    status: row.status ?? 'REJECT',
    tier: row.tier ?? 'REJECT',
    delivered: row.delivered ?? false,
    deduped: row.deduped ?? false,
    rejectionCount: row.rejectionCount ?? 0,
    marketCapUsd: row.marketCapUsd,
    liquidityUsd: row.liquidityUsd,
    change: (row.change as AuditEntry['change']) ?? 'NEW',
    previousStatus: row.previousStatus,
    distribution:
      dist !== null && dist !== undefined && typeof dist === 'object' && !Array.isArray(dist)
        ? (dist as AuditEntry['distribution'])
        : null,
  }
}

/**
 * Append audit entries to the DB. Entries arrive newest-first and must
 * already carry their change classification. Never throws.
 */
export async function saveAuditEntries(entries: AuditEntry[]): Promise<void> {
  try {
    if (entries.length > 0) {
      await prisma.sniperAuditEntry.createMany({ data: entries.map(toAuditRow) })
    }
  } catch (err) {
    console.error(`[db-stores] saveAuditEntries DB write failed: ${errorMessage(err)}`)
  }
  try {
    appendAuditEntries(entries, readSniperAudit())
  } catch (err) {
    console.error(`[db-stores] saveAuditEntries JSON write failed: ${errorMessage(err)}`)
  }
}

/**
 * Newest-first audit entries, optionally for one contract. DB first; JSON
 * fallback when the DB fails or has no rows while JSON has data.
 */
export async function loadAuditTrail(contract?: string, limit = 500): Promise<AuditEntry[]> {
  try {
    const rows = await prisma.sniperAuditEntry.findMany({
      where: contract !== undefined ? { contract } : undefined,
      orderBy: { observedAt: 'desc' },
      take: limit,
    })
    if (rows.length > 0) return rows.map(fromAuditRow)
    const json = readSniperAudit().entries
    return contract !== undefined ? json.filter((e) => e.contract === contract).slice(0, limit) : json.slice(0, limit)
  } catch (err) {
    console.error(`[db-stores] loadAuditTrail DB read failed: ${errorMessage(err)}`)
    const json = readSniperAudit().entries
    return contract !== undefined ? json.filter((e) => e.contract === contract).slice(0, limit) : json.slice(0, limit)
  }
}

// ─────────────────────────────────────────────────────────────
// Signal outcomes (data/sniper-outcomes.json → SniperSignalOutcome)
// ─────────────────────────────────────────────────────────────

function outcomeSignalId(signal: SignalOutcome): string {
  // Outcomes are idempotent per contract: the first delivery is the entry.
  return signal.contract
}

function toOutcomeRow(signal: SignalOutcome): Prisma.SniperSignalOutcomeCreateInput {
  const alertedAt = Number.isFinite(Date.parse(signal.deliveredAt))
    ? new Date(signal.deliveredAt)
    : new Date()
  return {
    signalId: outcomeSignalId(signal),
    contract: signal.contract,
    chain: SNIPER_CHAIN,
    symbol: signal.ticker,
    source: null,
    stage: null,
    tier: signal.tier,
    alertPriceUsd: signal.entryMarketCapUsd ?? 0,
    highestPriceUsd: 0,
    lowestPriceUsd: 0,
    currentPriceUsd: null,
    currentMcapUsd: signal.exitMarketCapUsd,
    status: signal.verdict,
    hitMultiple: null,
    roiPct: signal.returnPct !== null ? signal.returnPct * 100 : null,
    closedAt: signal.verdict !== 'PENDING' && signal.scoredAt !== null ? new Date(signal.scoredAt) : null,
    alertedAt,
    horizonHours: signal.horizonHours,
    dueAt: signal.dueAt !== null ? new Date(signal.dueAt) : null,
    returnPct: signal.returnPct,
    verdict: signal.verdict,
    scoredAt: signal.scoredAt !== null ? new Date(signal.scoredAt) : null,
    profileIds: signal.profileIds ?? [],
    profileBreaches: signal.profileBreaches ?? [],
    entryMarketCapUsd: signal.entryMarketCapUsd,
    exitMarketCapUsd: signal.exitMarketCapUsd,
  }
}

function toOutcomeUpdate(signal: SignalOutcome): Prisma.SniperSignalOutcomeUpdateInput {
  return {
    symbol: signal.ticker,
    tier: signal.tier,
    alertPriceUsd: signal.entryMarketCapUsd ?? 0,
    currentMcapUsd: signal.exitMarketCapUsd,
    status: signal.verdict,
    roiPct: signal.returnPct !== null ? signal.returnPct * 100 : null,
    closedAt: signal.verdict !== 'PENDING' && signal.scoredAt !== null ? new Date(signal.scoredAt) : null,
    horizonHours: signal.horizonHours,
    dueAt: signal.dueAt !== null ? new Date(signal.dueAt) : null,
    returnPct: signal.returnPct,
    verdict: signal.verdict,
    scoredAt: signal.scoredAt !== null ? new Date(signal.scoredAt) : null,
    profileIds: signal.profileIds ?? [],
    profileBreaches: signal.profileBreaches ?? [],
    entryMarketCapUsd: signal.entryMarketCapUsd,
    exitMarketCapUsd: signal.exitMarketCapUsd,
  }
}

function fromOutcomeRow(row: {
  signalId: string
  contract: string
  symbol: string
  tier: string | null
  status: string
  alertPriceUsd: number
  currentMcapUsd: number | null
  roiPct: number | null
  closedAt: Date | null
  alertedAt: Date
  horizonHours: number | null
  dueAt: Date | null
  returnPct: number | null
  verdict: string | null
  scoredAt: Date | null
  profileIds: string[]
  profileBreaches: string[]
  entryMarketCapUsd: number | null
  exitMarketCapUsd: number | null
}): SignalOutcome {
  const verdict = (row.verdict ?? row.status) as SignalOutcome['verdict']
  const entryMarketCapUsd = row.entryMarketCapUsd ?? (row.alertPriceUsd > 0 ? row.alertPriceUsd : null)
  return {
    contract: row.contract,
    ticker: row.symbol,
    tier: row.tier ?? '',
    deliveredAt: row.alertedAt.toISOString(),
    entryMarketCapUsd,
    horizonHours: row.horizonHours ?? 24,
    dueAt: row.dueAt !== null ? row.dueAt.toISOString() : null,
    exitMarketCapUsd: row.exitMarketCapUsd ?? row.currentMcapUsd,
    returnPct: row.returnPct ?? (row.roiPct !== null ? row.roiPct / 100 : null),
    verdict,
    scoredAt: row.scoredAt !== null ? row.scoredAt.toISOString() : null,
    profileIds: row.profileIds ?? [],
    profileBreaches: row.profileBreaches ?? [],
  }
}

/**
 * Upsert the full outcome log into the DB by signalId, then mirror it to
 * data/sniper-outcomes.json. Never throws.
 */
export async function saveOutcomes(log: OutcomeLog): Promise<void> {
  for (const signal of log.signals) {
    try {
      await prisma.sniperSignalOutcome.upsert({
        where: { signalId: outcomeSignalId(signal) },
        create: toOutcomeRow(signal),
        update: toOutcomeUpdate(signal),
      })
    } catch (err) {
      // NEVER-FAIL: a bad row must not break the rest of the sweep.
      console.error(`[db-stores] saveOutcomes DB write failed for ${signal.contract}: ${errorMessage(err)}`)
    }
  }
  try {
    writeOutcomes(log)
  } catch (err) {
    console.error(`[db-stores] saveOutcomes JSON write failed: ${errorMessage(err)}`)
  }
}

/**
 * Load the full outcome log. DB first; JSON fallback when the DB fails or
 * has no rows while JSON has data.
 */
export async function loadOutcomeLog(): Promise<OutcomeLog> {
  try {
    const rows = await prisma.sniperSignalOutcome.findMany({
      orderBy: { alertedAt: 'asc' },
    })
    if (rows.length > 0) {
      return {
        version: 1,
        signals: rows.map(fromOutcomeRow),
        updatedAt: rows.at(-1)?.updatedAt.toISOString() ?? null,
      }
    }
    return readOutcomes()
  } catch (err) {
    console.error(`[db-stores] loadOutcomeLog DB read failed: ${errorMessage(err)}`)
    return readOutcomes()
  }
}
