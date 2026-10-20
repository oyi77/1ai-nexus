// ─────────────────────────────────────────────────────────────
// Single-instance run lock for cron scripts.
//
// A scan pass can outlive its schedule (holder + wallet-activity fetches are
// slow), so overlapping crons pile up: several passes fight for the same
// GMGN quota and race on the same JSON artifacts. `mkdir` is atomic on every
// POSIX filesystem, so the lock is a directory whose existence means "a pass
// is running".
//
// A lock older than `staleMs` is reclaimed: a crashed pass must never wedge
// the cron forever. The caller owns release via the returned dispose function.
// ─────────────────────────────────────────────────────────────

import { mkdirSync, rmSync, statSync } from 'node:fs'

export interface RunLock {
  /** True when this process owns the lock and should do the work. */
  acquired: boolean
  /** Release the lock. Safe to call when not acquired. */
  release: () => void
}

/**
 * Try to take `lockPath`. Returns `{ acquired: false }` when another live pass
 * holds it, and reclaims the lock when its age exceeds `staleMs`.
 *
 * Never throws — a filesystem error degrades to "run anyway", because losing a
 * pass is worse than a rare duplicate.
 */
export function acquireRunLock(lockPath: string, staleMs: number): RunLock {
  const release = (): void => {
    try {
      rmSync(lockPath, { recursive: true, force: true })
    } catch {
      // A leftover lock is reclaimed by the stale check on a later pass.
    }
  }

  try {
    mkdirSync(lockPath)
    return { acquired: true, release }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'EEXIST') {
      console.warn(`[run-lock] lock error (${String(code)}) — running without a lock`)
      return { acquired: true, release: () => {} }
    }
  }

  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs
    if (ageMs > staleMs) {
      console.warn(`[run-lock] reclaiming stale lock (${Math.round(ageMs / 1000)}s old)`)
      rmSync(lockPath, { recursive: true, force: true })
      mkdirSync(lockPath)
      return { acquired: true, release }
    }
  } catch (err) {
    console.warn(`[run-lock] stale check failed: ${err instanceof Error ? err.message : String(err)}`)
    return { acquired: true, release: () => {} }
  }

  return { acquired: false, release: () => {} }
}
