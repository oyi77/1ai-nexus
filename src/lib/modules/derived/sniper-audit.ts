// ─────────────────────────────────────────────────────────────
// Meme Sniper — decision audit trail (Phase 7 of the operator pipeline).
//
// Two questions the seen-state alone could not answer:
//   1. "Why was this contract rejected at 06:25 and again at 06:55?" —
//      the ring-buffer log keeps decisions but no per-contract chain.
//   2. "Should a pinned contract be re-reviewed?" — the review digest
//      pinned a contract for 6h regardless of what changed underneath it.
//
// This module records one append-only entry per evaluation and classifies
// what changed versus the previous evaluation of the SAME contract. Rules
// are explicit and pure; the persist step is best-effort (a full disk must
// never fail a scan).
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SniperScanDecision } from './sniper-scan'

export interface AuditEntry {
  contract: string
  at: string
  status: string
  tier: string
  delivered: boolean
  deduped: boolean
  /** Hard-failure count — the number the operator triages on. */
  rejectionCount: number
  marketCapUsd: number | null
  liquidityUsd: number | null
  /** Contract-level change versus the previous evaluation, if any. */
  change: AuditChange
  previousStatus: string | null
}

export type AuditChange =
  | 'NEW'          // first time this contract is seen
  | 'UNCHANGED'    // same status, same rejection count, market within drift
  | 'MATERIAL'     // verdict, failure count, or market moved beyond drift

export interface SniperAudit {
  entries: AuditEntry[]
  updatedAt: string | null
}

const MAX_ENTRIES = 500
const DEFAULT_PATH = join(process.cwd(), 'data', 'sniper-audit.json')
/** Relative market-cap move that counts as material. */
const MATERIAL_PCT = 0.25

function auditPath(): string {
  return process.env.SNIPER_AUDIT_PATH || DEFAULT_PATH
}

function emptyAudit(): SniperAudit {
  return { entries: [], updatedAt: null }
}

/** Read the trail; a missing/corrupt file reads as empty. */
export function readSniperAudit(): SniperAudit {
  const path = auditPath()
  if (!existsSync(path)) return emptyAudit()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SniperAudit>
    if (!Array.isArray(raw.entries)) return emptyAudit()
    return { entries: raw.entries, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null }
  } catch {
    return emptyAudit()
  }
}

/**
 * Re-eval rule (pure). A verdict that did not move is not worth the
 * operator's attention; a status flip, a change in how many hard rules
 * failed, or a market cap that moved beyond MATERIAL_PCT is.
 */
export function classifyChange(prev: AuditEntry | null, current: Pick<AuditEntry, 'status' | 'rejectionCount' | 'marketCapUsd'>): AuditChange {
  if (!prev) return 'NEW'
  if (prev.status !== current.status) return 'MATERIAL'
  if (prev.rejectionCount !== current.rejectionCount) return 'MATERIAL'
  const a = prev.marketCapUsd
  const b = current.marketCapUsd
  if (a != null && b != null && a > 0) {
    if (Math.abs(b - a) / a >= MATERIAL_PCT) return 'MATERIAL'
  } else if ((a == null) !== (b == null)) {
    // A number appearing or vanishing changes what the operator can judge.
    return 'MATERIAL'
  }
  return 'UNCHANGED'
}

/** Newest-first entries for one contract — the per-contract chain. */
export function auditTrailFor(contract: string, audit: SniperAudit = readSniperAudit()): AuditEntry[] {
  return audit.entries.filter((e) => e.contract === contract)
}

function toEntry(d: SniperScanDecision, at: string, prev: AuditEntry | null): AuditEntry {
  const base = {
    contract: d.contract,
    at,
    status: d.status,
    tier: d.tier,
    delivered: d.delivered,
    deduped: d.deduped,
    rejectionCount: d.rejections.length,
    marketCapUsd: d.market?.marketCapUsd ?? null,
    liquidityUsd: d.market?.liquidityUsd ?? null,
  }
  return { ...base, change: classifyChange(prev, base), previousStatus: prev?.status ?? null }
}

/**
 * Record one scan pass. Entries are newest-first and capped; the previous
 * evaluation of each contract is looked up in the ALREADY-STORED trail, so
 * the change label is computed against real history, not this batch.
 */
export function appendSniperAudit(result: Pick<SniperScanResultLike, 'decisions'>): SniperAudit {
  const at = new Date().toISOString()
  const log = readSniperAudit()
  const previous = new Map<string, AuditEntry>()
  for (const e of log.entries) {
    if (!previous.has(e.contract)) previous.set(e.contract, e) // newest-first
  }
  const fresh = result.decisions.map((d) => toEntry(d, at, previous.get(d.contract) ?? null))
  const next: SniperAudit = {
    entries: [...fresh, ...log.entries].slice(0, MAX_ENTRIES),
    updatedAt: at,
  }
  try {
    const path = auditPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(next, null, 2))
  } catch {
    // best-effort: an unwritable audit file must never fail a scan
  }
  return next
}
/** Contracts whose last evaluation changed — the re-review set.
 *  A first sighting (NEW) counts: it is new information by definition. */
export function materiallyChanged(result: Pick<SniperScanResultLike, 'decisions'>): Set<string> {
  const audit = readSniperAudit()
  const previous = new Map<string, AuditEntry>()
  for (const e of audit.entries) if (!previous.has(e.contract)) previous.set(e.contract, e)
  const out = new Set<string>()
  for (const d of result.decisions) {
    const prev = previous.get(d.contract) ?? null
    const change = classifyChange(prev, {
      status: d.status,
      rejectionCount: d.rejections.length,
      marketCapUsd: d.market?.marketCapUsd ?? null,
    })
    if (change === 'MATERIAL' || change === 'NEW') out.add(d.contract)
  }
  return out
}

/** Minimal shape so this module never depends on the full scan result type. */
interface SniperScanResultLike {
  decisions: SniperScanDecision[]
}
