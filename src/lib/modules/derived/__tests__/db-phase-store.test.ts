import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const upsert = vi.fn()
const findMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    sniperPhase: {
      upsert: (...args: unknown[]) => upsert(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}))

// Mock sniper-phase JSON path so tests don't touch the real file.
const mockRead = vi.fn()

vi.mock('../sniper-phase', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../sniper-phase')>()
  return {
    ...orig,
    readSniperPhaseLog: (...args: unknown[]) => mockRead(...args),
  }
})

import {
  isPhaseDbDisabled,
  loadPhaseStates,
  loadPhaseLog,
  savePhaseStates,
  type SniperPhaseEntry,
} from '../db-phase-store'

let dir: string
let phasePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'db-phase-'))
  phasePath = join(dir, 'sniper-phase.json')
  process.env.SNIPER_PHASE_PATH = phasePath
  upsert.mockReset()
  findMany.mockReset()
  mockRead.mockReset()
})

afterEach(() => {
  delete process.env.SNIPER_PHASE_DB
  delete process.env.SNIPER_PHASE_PATH
})

function phaseEntry(overrides: Partial<SniperPhaseEntry> = {}): SniperPhaseEntry {
  return {
    contract: 'GxH5FBoEd4rC28UmMZcMjYWPHNEvYau6yKRfibQXpump',
    at: '2026-10-15T13:00:30.235Z',
    phase: 'DISTRIBUTION',
    score: 45,
    readings: 14,
    reason: null,
    ...overrides,
  }
}

describe('savePhaseStates', () => {
  it('upserts each entry by contract', async () => {
    upsert.mockResolvedValue({})
    await savePhaseStates([phaseEntry(), phaseEntry({ contract: 'mintB', score: 15 })])
    expect(upsert).toHaveBeenCalledTimes(2)
    const arg = upsert.mock.calls[0][0] as {
      where: { contract: string }
      create: { contract: string; phase: string; score: number; readings: number }
    }
    expect(arg.where.contract).toBe('GxH5FBoEd4rC28UmMZcMjYWPHNEvYau6yKRfibQXpump')
    expect(arg.create.phase).toBe('DISTRIBUTION')
    expect(arg.create.score).toBe(45)
    expect(arg.create.readings).toBe(14)
  })

  it('does nothing for empty input', async () => {
    await savePhaseStates([])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never throws when the DB upsert fails', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    await expect(
      savePhaseStates([phaseEntry(), phaseEntry({ contract: 'mintB' })]),
    ).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('updates the same contract (latest verdict wins)', async () => {
    upsert.mockResolvedValue({})
    await savePhaseStates([
      phaseEntry({ phase: 'ACCUMULATION', score: 80 }),
      phaseEntry({ phase: 'DISTRIBUTION', score: 45 }),
    ])
    // Both calls use the same contract; the second upsert's update should
    // carry the DISTRIBUTION verdict.
    const secondArg = upsert.mock.calls[1][0] as {
      update: { phase: string; score: number }
    }
    expect(secondArg.update.phase).toBe('DISTRIBUTION')
    expect(secondArg.update.score).toBe(45)
  })
})

describe('loadPhaseStates', () => {
  it('returns DB rows newest-first by at', async () => {
    const dateA = new Date('2026-10-15T13:00:30.235Z')
    const dateB = new Date('2026-10-15T12:50:24.707Z')
    findMany.mockResolvedValue([
      { contract: 'mintA', phase: 'DISTRIBUTION', score: 45, readings: 14, reason: null, at: dateA },
      { contract: 'mintB', phase: 'ACCUMULATION', score: 80, readings: 10, reason: null, at: dateB },
    ])
    const result = await loadPhaseStates()
    expect(result).toHaveLength(2)
    expect(result[0].contract).toBe('mintA')
    expect(result[0].phase).toBe('DISTRIBUTION')
    expect(result[0].at).toBe(dateA.toISOString())
    expect(result[1].phase).toBe('ACCUMULATION')
    const arg = findMany.mock.calls[0][0] as { orderBy: { at: string } }
    expect(arg.orderBy.at).toBe('desc')
  })

  it('filters by contract list when provided', async () => {
    findMany.mockResolvedValue([
      { contract: 'mintA', phase: 'DISTRIBUTION', score: 45, readings: 14, reason: null, at: new Date() },
    ])
    await loadPhaseStates(['mintA', 'mintC'])
    const arg = findMany.mock.calls[0][0] as { where: { contract: { in: string[] } } }
    expect(arg.where.contract.in).toEqual(['mintA', 'mintC'])
  })

  it('falls back to JSON when DB has no rows', async () => {
    findMany.mockResolvedValue([])
    mockRead.mockReturnValue({
      entries: [phaseEntry({ contract: 'jsonMint' })],
      updatedAt: '2026-10-15T13:00:30.235Z',
    })
    const result = await loadPhaseStates()
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe('jsonMint')
  })

  it('falls back to JSON without throwing when DB fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    mockRead.mockReturnValue({ entries: [], updatedAt: null })
    await expect(loadPhaseStates()).resolves.toEqual([])
  })

  it('filters JSON fallback by contract list', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    mockRead.mockReturnValue({
      entries: [phaseEntry({ contract: 'a' }), phaseEntry({ contract: 'b' })],
      updatedAt: null,
    })
    const result = await loadPhaseStates(['b'])
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe('b')
  })
})

describe('loadPhaseLog', () => {
  it('returns entries + updatedAt from the newest entry', async () => {
    const date = new Date('2026-10-15T13:00:30.235Z')
    findMany.mockResolvedValue([
      { contract: 'mint', phase: 'DISTRIBUTION', score: 45, readings: 14, reason: null, at: date },
    ])
    const log = await loadPhaseLog()
    expect(log.entries).toHaveLength(1)
    expect(log.updatedAt).toBe(date.toISOString())
  })

  it('returns null updatedAt when empty', async () => {
    findMany.mockResolvedValue([])
    mockRead.mockReturnValue({ entries: [], updatedAt: null })
    const log = await loadPhaseLog()
    expect(log.entries).toHaveLength(0)
    expect(log.updatedAt).toBeNull()
  })
})

describe('kill-switch (SNIPER_PHASE_DB=off)', () => {
  it('savePhaseStates skips prisma entirely', async () => {
    process.env.SNIPER_PHASE_DB = 'off'
    await savePhaseStates([phaseEntry()])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('loadPhaseStates reads JSON only and never calls prisma', async () => {
    process.env.SNIPER_PHASE_DB = 'off'
    mockRead.mockReturnValue({
      entries: [phaseEntry({ contract: 'killMint' })],
      updatedAt: '2026-10-15T13:00:30.235Z',
    })
    const result = await loadPhaseStates()
    expect(result[0].contract).toBe('killMint')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('loadPhaseStates with contract filter reads JSON only', async () => {
    process.env.SNIPER_PHASE_DB = 'off'
    mockRead.mockReturnValue({
      entries: [phaseEntry({ contract: 'a' }), phaseEntry({ contract: 'b' })],
      updatedAt: null,
    })
    const result = await loadPhaseStates(['b'])
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe('b')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('isPhaseDbDisabled returns true for off/false/0 and false otherwise', () => {
    process.env.SNIPER_PHASE_DB = 'off'
    expect(isPhaseDbDisabled()).toBe(true)
    process.env.SNIPER_PHASE_DB = 'false'
    expect(isPhaseDbDisabled()).toBe(true)
    process.env.SNIPER_PHASE_DB = '0'
    expect(isPhaseDbDisabled()).toBe(true)
    process.env.SNIPER_PHASE_DB = 'on'
    expect(isPhaseDbDisabled()).toBe(false)
    delete process.env.SNIPER_PHASE_DB
    expect(isPhaseDbDisabled()).toBe(false)
  })
})
