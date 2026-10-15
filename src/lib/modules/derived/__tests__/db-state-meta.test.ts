import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const upsert = vi.fn()
const findUnique = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    stateMeta: {
      upsert: (...args: unknown[]) => upsert(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}))

import { saveStateMeta, loadStateMeta } from '../db-state-meta'

let origCwd: string

beforeEach(() => {
  origCwd = process.cwd()
  const tmp = mkdtempSync(join(tmpdir(), 'state-meta-'))
  // db-state-meta uses process.cwd() + '/data' — override cwd so JSON
  // backup writes go to a throwaway dir.
  process.chdir(tmp)
  mkdirSync('data', { recursive: true })
  upsert.mockReset()
  findUnique.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(origCwd)
})

describe('saveStateMeta', () => {
  it('upserts to DB and writes JSON backup', async () => {
    upsert.mockResolvedValue({})
    await saveStateMeta('feed-health-prev', { working: 107, failedIds: ['physorg'] })

    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ scope: 'feed-health-prev' })
    expect(arg.create.data).toEqual({ working: 107, failedIds: ['physorg'] })

    const file = readFileSync(join(process.cwd(), 'data', 'feed-health-prev.json'), 'utf8')
    expect(JSON.parse(file)).toEqual({ working: 107, failedIds: ['physorg'] })
  })

  it('still writes JSON when DB throws (never-throw)', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    await saveStateMeta('zero-issue-state', { failures: ['health'], lastAlert: 't1' })

    expect(upsert).toHaveBeenCalledTimes(1)
    const file = readFileSync(join(process.cwd(), 'data', 'zero-issue-state.json'), 'utf8')
    expect(JSON.parse(file)).toEqual({ failures: ['health'], lastAlert: 't1' })
  })
})

describe('loadStateMeta', () => {
  it('returns DB row when present', async () => {
    findUnique.mockResolvedValue({ scope: 'feed-health-prev', data: { working: 50, failedIds: [] } })

    const result = await loadStateMeta<{ working: number; failedIds: string[] }>('feed-health-prev')

    expect(result).toEqual({ working: 50, failedIds: [] })
    expect(findUnique).toHaveBeenCalledWith({ where: { scope: 'feed-health-prev' } })
  })

  it('falls back to JSON when DB has no row', async () => {
    findUnique.mockResolvedValue(null)
    const path = join(process.cwd(), 'data', 'zero-issue-state.json')
    writeFileSync(path, JSON.stringify({ failures: ['api-check'], lastAlert: '2026-01-01' }))

    const result = await loadStateMeta<{ failures: string[] }>('zero-issue-state')

    expect(result).toEqual({ failures: ['api-check'], lastAlert: '2026-01-01' })
  })

  it('falls back to JSON when DB throws (never-throw)', async () => {
    findUnique.mockRejectedValue(new Error('db explosion'))
    const path = join(process.cwd(), 'data', 'feed-health-prev.json')
    writeFileSync(path, JSON.stringify({ working: 99, failedIds: ['f1'] }))

    const result = await loadStateMeta<{ working: number }>('feed-health-prev')

    expect(result).toEqual({ working: 99, failedIds: ['f1'] })
  })

  it('returns null when neither DB nor JSON has data', async () => {
    findUnique.mockResolvedValue(null)

    const result = await loadStateMeta('zero-issue-state')

    expect(result).toBeNull()
  })
})
