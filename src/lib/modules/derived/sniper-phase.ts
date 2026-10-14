// ─────────────────────────────────────────────────────────────
// Meme Sniper — accumulation phase log (TAHAP 2 persisted).
//
// The cron classified each contract's accumulation phase and printed it to
// stdout only, so the operator and the web UI had no durable answer to
// "has this contract ever looked like an accumulation?". This module
// persists the phase verdict per evaluation to data/sniper-phase.json
// (runtime state, gitignored — same class as data/sniper-log.json /
// data/sniper-audit.json).
//
// Append-only ring buffer, keyed by contract, newest first, capped at
// MAX_ENTRIES. A missing/corrupt file reads as empty — an unreadable log
// must never brick a scan. `shouldEmitPhase` is pure so the ACCUMULATION
// re-alert dedupe is unit-testable without I/O.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { classifyAccumulation, type AccumulationPhase, type PhaseVerdict } from './sniper-accumulation'
import { accumulationReadings, type SniperAudit } from './sniper-audit'
import type { SniperScanDecision } from './sniper-scan'

/** One persisted phase verdict. `phase` is the real PhaseVerdict string. */
export interface SniperPhaseEntry {
  contract: string
  /** ISO timestamp of the evaluation. */
  at: string
  phase: PhaseVerdict
  /** 0..100 evidence-weighted score. */
  score: number
  /** Number of readings the classifier used. */
  readings: number
  /** Why the verdict was UNKNOWN, when it was. */
  reason: string | null
}

export interface SniperPhaseLog {
  /** Newest first, capped at MAX_ENTRIES. */
  entries: SniperPhaseEntry[]
  /** ISO timestamp of the last write, or null when nothing was ever logged. */
  updatedAt: string | null
}

export const MAX_PHASE_ENTRIES = 500
export const DEFAULT_PHASE_COOLDOWN_MS = 6 * 60 * 60_000
const DEFAULT_PATH = join(process.cwd(), 'data', 'sniper-phase.json')

function phasePath(): string {
  return process.env.SNIPER_PHASE_PATH || DEFAULT_PATH
}

function emptyPhaseLog(): SniperPhaseLog {
  return { entries: [], updatedAt: null }
}

/** Read the persisted phase log; a missing/corrupt file reads as empty. */
export function readSniperPhaseLog(): SniperPhaseLog {
  const path = phasePath()
  if (!existsSync(path)) return emptyPhaseLog()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SniperPhaseLog>
    if (!Array.isArray(raw.entries)) return emptyPhaseLog()
    return { entries: raw.entries, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null }
  } catch {
    return emptyPhaseLog()
  }
}

function phaseCooldownMs(): number {
  const raw = Number(process.env.SNIPER_PHASE_COOLDOWN_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PHASE_COOLDOWN_MS
}

function writePhaseLog(log: SniperPhaseLog): void {
  const path = phasePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(log, null, 2))
}

/**
 * Pure re-alert gate. An ACCUMULATION verdict for a contract whose latest
 * persisted phase was already ACCUMULATION within the cooldown window must
 * not be re-sent. Null (first sighting), a different verdict, an unparseable
 * timestamp, or a verdict outside the window all emit.
 */
export function shouldEmitPhase(
  latestEntry: SniperPhaseEntry | null,
  nowMs: number,
  cooldownMs: number,
): boolean {
  if (latestEntry === null) return true
  if (latestEntry.phase !== 'ACCUMULATION') return true
  const at = Date.parse(latestEntry.at)
  if (!Number.isFinite(at)) return true
  return nowMs - at >= cooldownMs
}

/** Per-decision phase computation plus the re-alert gate result. */
export interface PersistedPhaseDecision {
  contract: string
  ticker: string
  phase: AccumulationPhase
  /** True when this pass should emit an ACCUMULATION alert to the review chat. */
  alert: boolean
}

export interface PersistPhasesResult {
  log: SniperPhaseLog
  /** One entry per input decision (including UNKNOWN, which is not persisted). */
  phases: PersistedPhaseDecision[]
  /** Subset of `phases` whose ACCUMULATION verdict passed the cooldown gate. */
  alerts: PersistedPhaseDecision[]
}

/**
 * Classify and persist this pass's accumulation phases. Only non-UNKNOWN
 * verdicts are appended (newest first, capped); UNKNOWN is computed for the
 * caller's stdout but is never evidence, so it is never persisted. The
 * ACCUMULATION re-alert gate is evaluated against the PREVIOUSLY persisted
 * entry for each contract, so a first sighting always passes and a repeat
 * within the cooldown window does not.
 *
 * Best-effort like the audit/log modules: a write failure must never fail
 * a scan. `audit` is injectable so tests never touch the real trail.
 */
export function persistAccumulationPhases(
  decisions: Array<Pick<SniperScanDecision, 'contract' | 'ticker'>>,
  audit?: SniperAudit,
): PersistPhasesResult {
  const now = new Date()
  const nowMs = now.getTime()
  const cooldownMs = phaseCooldownMs()
  const log = readSniperPhaseLog()
  const previous = new Map<string, SniperPhaseEntry>()
  for (const e of log.entries) {
    if (!previous.has(e.contract)) previous.set(e.contract, e) // newest first
  }

  const fresh: SniperPhaseEntry[] = []
  const phases: PersistedPhaseDecision[] = []
  const alerts: PersistedPhaseDecision[] = []
  for (const d of decisions) {
    const phase = classifyAccumulation(accumulationReadings(d.contract, audit))
    const latest = previous.get(d.contract) ?? null
    const alert = phase.verdict === 'ACCUMULATION' && shouldEmitPhase(latest, nowMs, cooldownMs)
    phases.push({ contract: d.contract, ticker: d.ticker, phase, alert })
    if (alert) alerts.push({ contract: d.contract, ticker: d.ticker, phase, alert })

    if (phase.verdict === 'UNKNOWN') continue
    fresh.push({
      contract: d.contract,
      at: now.toISOString(),
      phase: phase.verdict,
      score: phase.score,
      readings: phase.readings,
      reason: phase.reason ?? null,
    })
  }

  const next: SniperPhaseLog = {
    entries: [...fresh, ...log.entries].slice(0, MAX_PHASE_ENTRIES),
    updatedAt: fresh.length > 0 ? now.toISOString() : log.updatedAt,
  }
  if (fresh.length > 0) {
    try {
      writePhaseLog(next)
    } catch {
      // best-effort: an unwritable phase log must never fail a scan
    }
  }
  return { log: next, phases, alerts }
}
