import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync, mkdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireRunLock } from '@/lib/modules/derived/run-lock'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'run-lock-'))
}

describe('acquireRunLock', () => {
  it('acquires a fresh lock and releases it on dispose', () => {
    const dir = tempDir()
    const lockPath = join(dir, 'lock')
    try {
      const first = acquireRunLock(lockPath, 60_000)
      expect(first.acquired).toBe(true)
      first.release()

      // Released lock may be taken again.
      const second = acquireRunLock(lockPath, 60_000)
      expect(second.acquired).toBe(true)
      second.release()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loses the lock to a concurrent holder and never removes it', () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, 'held'))
      const result = acquireRunLock(join(dir, 'held'), 3_600_000)
      expect(result.acquired).toBe(false)
      result.release()
      // Not the owner → still present.
      expect(() => mkdirSync(join(dir, 'held'))).toThrowError(/EEXIST/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reclaims a lock past the stale threshold', () => {
    const dir = tempDir()
    const lockPath = join(dir, 'stale')
    try {
      mkdirSync(lockPath)
      // Mtime is fresh at creation; make it old by rewriting what we can
      // via utimes instead of sleep.
      const old = new Date(Date.now() - 3_600_000)
      utimesSync(lockPath, old, old)

      const reclaimed = acquireRunLock(lockPath, 30 * 60_000)
      expect(reclaimed.acquired).toBe(true)
      reclaimed.release()
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
