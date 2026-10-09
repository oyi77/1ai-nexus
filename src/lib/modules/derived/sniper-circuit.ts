// ─────────────────────────────────────────────────────────────
// Meme Sniper — daily stop circuit.
//
// Rule: 3 CONSECUTIVE stop-losses in one day locks trading until the
// next day (or an explicit reset). A single clean exit resets the streak:
// the circuit tracks a losing streak, not a loss count.
//
// State lives in data/sniper-circuit.json (runtime state, gitignored —
// same class as data/zero-issue-state.json). A missing/corrupt file is
// treated as a fresh day, never as "locked": an unreadable file must not
// brick the sniper, but the on-disk state is the source of truth.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MAX_CONSECUTIVE_STOP_LOSSES } from './meme-sniper'

export interface SniperCircuitState {
  /** UTC day (YYYY-MM-DD) the streak belongs to. */
  date: string
  /** Consecutive stop-losses recorded today. */
  consecutiveLosses: number
  /** Wins/exits recorded today (diagnostic only). */
  wins: number
  /** True once the streak hit the cap. */
  locked: boolean
  updatedAt: string
}

const DEFAULT_PATH = join(process.cwd(), 'data', 'sniper-circuit.json')

function statePath(): string {
  return process.env.SNIPER_CIRCUIT_PATH || DEFAULT_PATH
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function freshDay(date: string): SniperCircuitState {
  return { date, consecutiveLosses: 0, wins: 0, locked: false, updatedAt: new Date().toISOString() }
}

export function readSniperCircuit(now = new Date()): SniperCircuitState {
  const today = todayUtc(now)
  try {
    const p = statePath()
    if (!existsSync(p)) return freshDay(today)
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<SniperCircuitState>
    // A stale day means the clock rolled over — the lock is day-scoped.
    if (parsed.date !== today) return freshDay(today)
    return {
      date: today,
      consecutiveLosses: Number(parsed.consecutiveLosses) || 0,
      wins: Number(parsed.wins) || 0,
      locked: parsed.locked === true,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return freshDay(today)
  }
}

function write(state: SniperCircuitState): SniperCircuitState {
  try {
    const p = statePath()
    mkdirSync(dirname(p), { recursive: true })
    state.updatedAt = new Date().toISOString()
    writeFileSync(p, JSON.stringify(state, null, 2))
  } catch { /* state persistence unavailable — return the in-memory truth */ }
  return state
}

/** True when the daily circuit has tripped — no snipe may be issued. */
export function isSniperCircuitLocked(now = new Date()): boolean {
  return readSniperCircuit(now).locked
}

/** Record a stop-loss. Third consecutive one of the day locks trading. */
export function recordSniperStopLoss(now = new Date()): SniperCircuitState {
  const s = readSniperCircuit(now)
  s.consecutiveLosses += 1
  if (s.consecutiveLosses >= MAX_CONSECUTIVE_STOP_LOSSES) s.locked = true
  return write(s)
}

/** Record a win/clean exit — breaks the losing streak. */
export function recordSniperWin(now = new Date()): SniperCircuitState {
  const s = readSniperCircuit(now)
  s.wins += 1
  s.consecutiveLosses = 0
  s.locked = false
  return write(s)
}

/** Manual reset (operator override). Clears the streak and the lock. */
export function resetSniperCircuit(now = new Date()): SniperCircuitState {
  return write(freshDay(todayUtc(now)))
}
