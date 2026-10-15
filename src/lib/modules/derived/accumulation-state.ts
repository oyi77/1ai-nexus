// ─────────────────────────────────────────────────────────────
// Whale accumulation alert — dedupe state store.
//
// Keeps `lastSentAtMs` per token contract so the same accumulation
// cannot fire twice inside the cooldown window. The file is runtime
// state (gitignored), regenerated on demand — the same discipline as
// data/sniper-outcomes.json.
//
// Rules:
//   - missing/corrupt file reads as empty, never throws
//   - entries older than 7d are pruned on read AND write so the file
//     never grows without bound
//   - markSent is pure (returns the next state); callers persist it.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  isAccumulationSeen as isAccumulationSeenDb,
  markAccumulationSeen as markAccumulationSeenDb,
} from './db-seen-store'
export { isAccumulationSeenDb as isAccumulationSeen, markAccumulationSeenDb as markAccumulationSeen }
export type AccumulationState = Record<string, number>

const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function statePath(): string {
  return process.env.ACCUMULATION_STATE_PATH ?? join(process.cwd(), 'data', 'accumulation-alert-state.json')
}

export function emptyAccumulationState(): AccumulationState {
  return {}
}

/**
 * Drop entries whose lastSentAtMs is older than `ttlMs`. Pure — returns a
 * new object so a caller can prune without touching the file.
 */
export function pruneAccumulationState(
  state: AccumulationState,
  nowMs: number = Date.now(),
  ttlMs: number = STATE_TTL_MS,
): AccumulationState {
  const out: AccumulationState = {}
  for (const [contract, at] of Object.entries(state)) {
    if (typeof at === 'number' && Number.isFinite(at) && nowMs - at <= ttlMs) {
      out[contract] = at
    }
  }
  return out
}

/** Read the state; a missing/corrupt file reads as empty (never throws). */
export function readState(): AccumulationState {
  const path = statePath()
  if (!existsSync(path)) return emptyAccumulationState()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyAccumulationState()
    const state: AccumulationState = {}
    for (const [contract, at] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) state[contract] = at
    }
    return pruneAccumulationState(state)
  } catch {
    return emptyAccumulationState()
  }
}

/** Record a sent alert for a contract. Pure — returns the next state. */
export function markSent(
  state: AccumulationState,
  contract: string,
  atMs: number = Date.now(),
): AccumulationState {
  return { ...state, [contract]: atMs }
}

/** Persist the state; prunes stale entries and creates the directory. */
export function writeState(state: AccumulationState): AccumulationState {
  const next = pruneAccumulationState(state)
  const path = statePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2))
  return next
}
