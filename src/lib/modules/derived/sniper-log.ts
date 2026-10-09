// ─────────────────────────────────────────────────────────────
// Meme Sniper — decision log.
//
// The cron evaluates tokens and pushes alerts to Telegram, but the
// decisions themselves were only ever logged to stdout, so the web UI had
// nothing to render. This module persists the last N decisions to
// data/sniper-log.json (runtime state, gitignored — same class as
// data/sniper-seen.json / data/sniper-circuit.json).
//
// Append-only ring buffer: newest first, capped at MAX_ENTRIES. A corrupt
// or missing file reads as an empty log — an unreadable log must never
// brick a scan.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SniperStatus } from './meme-sniper'
import type { SniperScanDecision, SniperScanResult } from './sniper-scan'

/** One persisted scan decision — the scan shape minus the Telegram body. */
export type SniperLogEntry = Omit<SniperScanDecision, 'alert'>

export interface SniperLog {
  /** Newest first. */
  entries: SniperLogEntry[]
  /** ISO timestamp of the last write, or null when nothing was ever logged. */
  updatedAt: string | null
  /** Aggregate counters of the last scan pass that wrote to the log. */
  lastScan: {
    at: string
    scanned: number
    executed: number
    watchlisted: number
    rejected: number
    delivered: number
    errors: string[]
  } | null
}

const MAX_ENTRIES = 200
const DEFAULT_PATH = join(process.cwd(), 'data', 'sniper-log.json')

function logPath(): string {
  return process.env.SNIPER_LOG_PATH || DEFAULT_PATH
}

function emptyLog(): SniperLog {
  return { entries: [], updatedAt: null, lastScan: null }
}

/** Read the persisted log; a missing/corrupt file reads as empty. */
export function readSniperLog(): SniperLog {
  const path = logPath()
  if (!existsSync(path)) return emptyLog()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SniperLog>
    if (!Array.isArray(raw.entries)) return emptyLog()
    return {
      entries: raw.entries,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      lastScan: raw.lastScan ?? null,
    }
  } catch {
    return emptyLog()
  }
}

function write(log: SniperLog): void {
  const path = logPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(log, null, 2))
}

/**
 * Persist one scan pass: new decisions prepended (newest first), capped at
 * MAX_ENTRIES, plus the aggregate counters. Returns the stored log.
 * Never throws on a write failure — a full disk must not fail a scan.
 */
export function appendSniperScan(
  result: Pick<SniperScanResult, 'decisions' | 'scanned' | 'executed' | 'watchlisted' | 'rejected' | 'delivered' | 'errors'>,
): SniperLog {
  const at = new Date().toISOString()
  const log = readSniperLog()
  const fresh: SniperLogEntry[] = result.decisions.map(({ alert: _alert, ...rest }) => rest)
  const next: SniperLog = {
    entries: [...fresh, ...log.entries].slice(0, MAX_ENTRIES),
    updatedAt: at,
    lastScan: {
      at,
      scanned: result.scanned,
      executed: result.executed,
      watchlisted: result.watchlisted,
      rejected: result.rejected,
      delivered: result.delivered,
      errors: result.errors,
    },
  }
  try {
    write(next)
  } catch (err) {
    // Callers treat the log as best-effort; surface via the returned value.
    next.lastScan!.errors = [
      ...next.lastScan!.errors,
      `log write failed: ${err instanceof Error ? err.message : String(err)}`,
    ]
  }
  return next
}

/** Counts by status across the persisted log — for the UI summary strip. */
export function sniperLogCounts(log: SniperLog): Record<SniperStatus | 'total', number> {
  const counts: Record<SniperStatus | 'total', number> = {
    EXECUTE: 0,
    WATCHLIST: 0,
    REJECT: 0,
    total: log.entries.length,
  }
  for (const e of log.entries) counts[e.status]++
  return counts
}
