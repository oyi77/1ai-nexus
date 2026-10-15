import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const findUnique = vi.fn()
const findMany = vi.fn()
const upsert = vi.fn()
const deleteMany = vi.fn()
const deleteOne = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    sniperReviewSeen: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
      delete: (...args: unknown[]) => deleteOne(...args),
    },
  },
}))

import {
  filterUnseenKeys,
  isKeySeen,
  isSeenDbDisabled,
  markKeySeen,
  pruneExpiredKeys,
} from '../db-seen-store'

beforeEach(() => {
  findUnique.mockReset()
  findMany.mockReset()
  upsert.mockReset()
  deleteMany.mockReset()
  deleteOne.mockReset()
})

afterEach(() => {
  delete process.env.SNIPER_SEEN_DB
})

describe('isKeySeen', () => {
  it('returns true for a row that has not expired', async () => {
    findUnique.mockResolvedValue({
      key: 'review:mint',
      seenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(isKeySeen('review:mint')).resolves.toBe(true)
    expect(deleteOne).not.toHaveBeenCalled()
  })

  it('returns false and lazily deletes an expired row', async () => {
    findUnique.mockResolvedValue({
      key: 'review:mint',
      seenAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    })
    deleteOne.mockResolvedValue({ key: 'review:mint' })
    await expect(isKeySeen('review:mint')).resolves.toBe(false)
    expect(deleteOne).toHaveBeenCalledWith({ where: { key: 'review:mint' } })
  })

  it('returns false for a missing key', async () => {
    findUnique.mockResolvedValue(null)
    await expect(isKeySeen('scan:solana:mint')).resolves.toBe(false)
  })

  it('falls back to the JSON backup when the DB throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seen-fallback-'))
    const path = join(dir, 'sniper-review-seen.json')
    writeFileSync(path, JSON.stringify({ mintA: Date.now() }))
    process.env.SNIPER_REVIEW_SEEN_PATH = path
    findUnique.mockRejectedValue(new Error('db down'))
    await expect(isKeySeen('review:mintA')).resolves.toBe(true)
    await expect(isKeySeen('review:mintB')).resolves.toBe(false)
    delete process.env.SNIPER_REVIEW_SEEN_PATH
  })
})

describe('markKeySeen', () => {
  it('upserts with expiresAt derived from ttlMs and dual-writes the JSON backup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seen-mark-'))
    process.env.SNIPER_REVIEW_SEEN_PATH = join(dir, 'sniper-review-seen.json')
    upsert.mockResolvedValue({})
    const before = Date.now()
    await markKeySeen('review:mint', 60_000)
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0] as {
      where: { key: string }
      create: { key: string; seenAt: Date; expiresAt: Date }
    }
    expect(arg.where).toEqual({ key: 'review:mint' })
    expect(arg.create.key).toBe('review:mint')
    expect(arg.create.expiresAt.getTime() - before).toBeGreaterThanOrEqual(60_000)
    expect(arg.create.expiresAt.getTime() - before).toBeLessThan(61_000)
    delete process.env.SNIPER_REVIEW_SEEN_PATH
  })

  it('never throws when the DB upsert fails', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    await expect(markKeySeen('review:mint', 60_000)).resolves.toBeUndefined()
  })
})

describe('pruneExpiredKeys', () => {
  it('deleteMany with lt: now and returns the deleted count', async () => {
    deleteMany.mockResolvedValue({ count: 7 })
    await expect(pruneExpiredKeys()).resolves.toBe(7)
    const arg = deleteMany.mock.calls[0][0] as { where: { expiresAt: { lt: Date } } }
    expect(arg.where.expiresAt.lt).toBeInstanceOf(Date)
    expect(arg.where.expiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('returns -1 when the DB is unreachable', async () => {
    deleteMany.mockRejectedValue(new Error('db down'))
    await expect(pruneExpiredKeys()).resolves.toBe(-1)
  })
})

describe('filterUnseenKeys', () => {
  it('returns only keys absent from the live DB rows', async () => {
    findMany.mockResolvedValue([{ key: 'review:a' }])
    await expect(filterUnseenKeys(['review:a', 'review:b', 'review:c'])).resolves.toEqual([
      'review:b',
      'review:c',
    ])
    const arg = findMany.mock.calls[0][0] as {
      where: { key: { in: string[] }; expiresAt: { gt: Date } }
    }
    expect(arg.where.key.in).toEqual(['review:a', 'review:b', 'review:c'])
    expect(arg.where.expiresAt.gt).toBeInstanceOf(Date)
  })

  it('dedupes the input and returns [] for empty input', async () => {
    findMany.mockResolvedValue([])
    await expect(filterUnseenKeys(['review:a', 'review:a'])).resolves.toEqual(['review:a'])
    await expect(filterUnseenKeys([])).resolves.toEqual([])
  })

  it('falls back to JSON without throwing when the DB fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seen-filter-'))
    const path = join(dir, 'sniper-review-seen.json')
    writeFileSync(path, JSON.stringify({ a: Date.now() }))
    process.env.SNIPER_REVIEW_SEEN_PATH = path
    findMany.mockRejectedValue(new Error('db down'))
    await expect(filterUnseenKeys(['review:a', 'review:b'])).resolves.toEqual(['review:b'])
    delete process.env.SNIPER_REVIEW_SEEN_PATH
  })
})

describe('kill-switch (SNIPER_SEEN_DB=off)', () => {
  it('isKeySeen reads JSON only and never calls prisma', async () => {
    process.env.SNIPER_SEEN_DB = 'off'
    const dir = mkdtempSync(join(tmpdir(), 'seen-kill-'))
    const path = join(dir, 'sniper-review-seen.json')
    writeFileSync(path, JSON.stringify({ killMint: Date.now() }))
    process.env.SNIPER_REVIEW_SEEN_PATH = path
    await expect(isKeySeen('review:killMint')).resolves.toBe(true)
    await expect(isKeySeen('review:nope')).resolves.toBe(false)
    expect(findUnique).not.toHaveBeenCalled()
    delete process.env.SNIPER_REVIEW_SEEN_PATH
  })

  it('markKeySeen does not call prisma and writes JSON only', async () => {
    process.env.SNIPER_SEEN_DB = 'off'
    const dir = mkdtempSync(join(tmpdir(), 'seen-kill-mark-'))
    const path = join(dir, 'sniper-review-seen.json')
    process.env.SNIPER_REVIEW_SEEN_PATH = path
    await markKeySeen('review:killMint', 60_000)
    expect(upsert).not.toHaveBeenCalled()
    delete process.env.SNIPER_REVIEW_SEEN_PATH
  })

  it('isSeenDbDisabled returns true for off/false/0 and false otherwise', () => {
    process.env.SNIPER_SEEN_DB = 'off'
    expect(isSeenDbDisabled()).toBe(true)
    process.env.SNIPER_SEEN_DB = 'false'
    expect(isSeenDbDisabled()).toBe(true)
    process.env.SNIPER_SEEN_DB = '0'
    expect(isSeenDbDisabled()).toBe(true)
    process.env.SNIPER_SEEN_DB = 'on'
    expect(isSeenDbDisabled()).toBe(false)
    delete process.env.SNIPER_SEEN_DB
    expect(isSeenDbDisabled()).toBe(false)
  })
})
