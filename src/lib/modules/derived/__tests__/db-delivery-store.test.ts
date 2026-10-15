import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const upsert = vi.fn()
const findMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    sniperDeliveryLog: {
      upsert: (...args: unknown[]) => upsert(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}))

// Mock the meme-sniper JSON path so tests don't touch the real file.
const mockAppend = vi.fn()
const mockRead = vi.fn()

vi.mock('../meme-sniper', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../meme-sniper')>()
  return {
    ...orig,
    appendSniperDeliveryLog: (...args: unknown[]) => mockAppend(...args),
    readSniperDeliveryLog: (...args: unknown[]) => mockRead(...args),
  }
})

import {
  isDeliveryDbDisabled,
  loadRecentDeliveries,
  loadDeliveryLog,
  saveDeliveryEntries,
  type SniperDeliveryLogEntry,
} from '../db-delivery-store'

let dir: string
let deliveryPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'db-delivery-'))
  deliveryPath = join(dir, 'sniper-delivery-log.json')
  process.env.SNIPER_DELIVERY_LOG_PATH = deliveryPath
  upsert.mockReset()
  findMany.mockReset()
  mockAppend.mockReset()
  mockRead.mockReset()
})

afterEach(() => {
  delete process.env.SNIPER_DELIVERY_DB
  delete process.env.SNIPER_DELIVERY_LOG_PATH
})

function entry(overrides: Partial<SniperDeliveryLogEntry> = {}): SniperDeliveryLogEntry {
  return {
    at: '2026-10-15T12:00:00.000Z',
    chatId: '157228659',
    contract: 'GxH5FBoEd4rC28UmMZcMjYWPHNEvYau6yKRfibQXpump',
    messageTextPrefix: '🔎 <b>VILONA — MANUAL REVIEW</b>',
    ok: true,
    status: 200,
    error: null,
    attemptCount: 1,
    truncated: false,
    ...overrides,
  }
}

describe('saveDeliveryEntries', () => {
  it('upserts each entry by deliveryKey', async () => {
    upsert.mockResolvedValue({})
    await saveDeliveryEntries([entry(), entry({ at: '2026-10-15T12:01:00.000Z' })])
    expect(upsert).toHaveBeenCalledTimes(2)
    const arg = upsert.mock.calls[0][0] as {
      where: { deliveryKey: string }
      create: { deliveryKey: string; contract: string; ok: boolean }
    }
    expect(arg.where.deliveryKey).toBe('GxH5FBoEd4rC28UmMZcMjYWPHNEvYau6yKRfibQXpump:2026-10-15T12:00:00.000Z')
    expect(arg.create.ok).toBe(true)
  })

  it('does nothing for empty input', async () => {
    await saveDeliveryEntries([])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never throws when the DB upsert fails', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    await expect(saveDeliveryEntries([entry(), entry({ contract: null })])).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('handles null contract in deliveryKey', async () => {
    upsert.mockResolvedValue({})
    await saveDeliveryEntries([entry({ contract: null })])
    const arg = upsert.mock.calls[0][0] as { where: { deliveryKey: string } }
    expect(arg.where.deliveryKey).toBe('none:2026-10-15T12:00:00.000Z')
  })
})

describe('loadRecentDeliveries', () => {
  it('returns DB rows newest-first by deliveredAt', async () => {
    const dateA = new Date('2026-10-15T12:01:00.000Z')
    const dateB = new Date('2026-10-15T12:00:00.000Z')
    findMany.mockResolvedValue([
      { contract: 'mintA', chatId: null, messageTextPrefix: 'p1', ok: true, status: 200, error: null, attemptCount: 1, truncated: false, deliveredAt: dateA },
      { contract: 'mintB', chatId: null, messageTextPrefix: 'p2', ok: false, status: 400, error: 'bad', attemptCount: 2, truncated: false, deliveredAt: dateB },
    ])
    const result = await loadRecentDeliveries(50)
    expect(result).toHaveLength(2)
    expect(result[0].contract).toBe('mintA')
    expect(result[0].at).toBe(dateA.toISOString())
    expect(result[1].ok).toBe(false)
    const arg = findMany.mock.calls[0][0] as { orderBy: { deliveredAt: string }; take: number }
    expect(arg.orderBy.deliveredAt).toBe('desc')
    expect(arg.take).toBe(50)
  })

  it('falls back to JSON when DB has no rows', async () => {
    findMany.mockResolvedValue([])
    mockRead.mockReturnValue({
      entries: [entry({ contract: 'jsonMint' })],
      updatedAt: '2026-10-15T12:00:00.000Z',
    })
    const result = await loadRecentDeliveries()
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe('jsonMint')
  })

  it('falls back to JSON without throwing when DB fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    mockRead.mockReturnValue({ entries: [], updatedAt: null })
    await expect(loadRecentDeliveries()).resolves.toEqual([])
  })
})

describe('loadDeliveryLog', () => {
  it('returns entries + updatedAt from the newest entry', async () => {
    const date = new Date('2026-10-15T12:00:00.000Z')
    findMany.mockResolvedValue([
      { contract: 'mint', chatId: null, messageTextPrefix: 'p', ok: true, status: 200, error: null, attemptCount: 1, truncated: false, deliveredAt: date },
    ])
    const log = await loadDeliveryLog()
    expect(log.entries).toHaveLength(1)
    expect(log.updatedAt).toBe(date.toISOString())
  })

  it('returns null updatedAt when empty', async () => {
    findMany.mockResolvedValue([])
    mockRead.mockReturnValue({ entries: [], updatedAt: null })
    const log = await loadDeliveryLog()
    expect(log.entries).toHaveLength(0)
    expect(log.updatedAt).toBeNull()
  })
})

describe('kill-switch (SNIPER_DELIVERY_DB=off)', () => {
  it('saveDeliveryEntries skips prisma entirely', async () => {
    process.env.SNIPER_DELIVERY_DB = 'off'
    await saveDeliveryEntries([entry()])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('loadRecentDeliveries reads JSON only and never calls prisma', async () => {
    process.env.SNIPER_DELIVERY_DB = 'off'
    mockRead.mockReturnValue({
      entries: [entry({ contract: 'killMint' })],
      updatedAt: '2026-10-15T12:00:00.000Z',
    })
    const result = await loadRecentDeliveries()
    expect(result[0].contract).toBe('killMint')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('isDeliveryDbDisabled returns true for off/false/0 and false otherwise', () => {
    process.env.SNIPER_DELIVERY_DB = 'off'
    expect(isDeliveryDbDisabled()).toBe(true)
    process.env.SNIPER_DELIVERY_DB = 'false'
    expect(isDeliveryDbDisabled()).toBe(true)
    process.env.SNIPER_DELIVERY_DB = '0'
    expect(isDeliveryDbDisabled()).toBe(true)
    process.env.SNIPER_DELIVERY_DB = 'on'
    expect(isDeliveryDbDisabled()).toBe(false)
    delete process.env.SNIPER_DELIVERY_DB
    expect(isDeliveryDbDisabled()).toBe(false)
  })
})
