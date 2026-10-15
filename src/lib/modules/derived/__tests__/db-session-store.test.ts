import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const upsert = vi.fn()
const findUnique = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    sessionToken: {
      upsert: (...args: unknown[]) => upsert(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}))

import { saveSessionToken, loadSessionToken, mirrorSessionTokenSync } from '../db-session-store'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sess-store-'))
  process.env.ALPHIO_SESSION_PATH = join(dataDir, 'alphio-session.json')
  process.env.GMGN_SESSION_PATH = join(dataDir, 'gmgn-session.json')
  process.env.MOBY_SESSION_PATH = join(dataDir, 'moby-session.json')
  process.env.STOCKBIT_SESSION_PATH = join(dataDir, 'stockbit-session.json')
  process.env.MOBY_FALLBACK_SESSION_PATH = join(dataDir, 'moby-session-fallback.json')
  upsert.mockReset()
  findUnique.mockReset()
  // db-stores uses console.error on failures — silence it in tests.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const k of ['ALPHIO_SESSION_PATH', 'GMGN_SESSION_PATH', 'MOBY_SESSION_PATH', 'STOCKBIT_SESSION_PATH', 'MOBY_FALLBACK_SESSION_PATH']) {
    delete process.env[k]
  }
})

describe('saveSessionToken', () => {
  it('upserts to DB and writes JSON backup', async () => {
    upsert.mockResolvedValue({})
    await saveSessionToken('alphio', { accessToken: 'tok', accessTokenExp: 999 }, null)

    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ provider: 'alphio' })
    expect(arg.create.provider).toBe('alphio')
    expect(arg.create.data).toEqual({ accessToken: 'tok', accessTokenExp: 999 })

    const file = readFileSync(process.env.ALPHIO_SESSION_PATH!, 'utf8')
    expect(JSON.parse(file)).toEqual({ accessToken: 'tok', accessTokenExp: 999 })
  })

  it('still writes JSON when DB throws (never-throw)', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    await saveSessionToken('gmgn', { cookie: 'cf_clearance=abc' }, null)

    expect(upsert).toHaveBeenCalledTimes(1)
    const file = readFileSync(process.env.GMGN_SESSION_PATH!, 'utf8')
    expect(JSON.parse(file)).toEqual({ cookie: 'cf_clearance=abc' })
  })
})

describe('loadSessionToken', () => {
  it('returns DB row when present', async () => {
    findUnique.mockResolvedValue({ provider: 'moby', data: { accessToken: 'db-tok' }, expiresAt: null })

    const result = await loadSessionToken<{ accessToken: string }>('moby')

    expect(result).toEqual({ accessToken: 'db-tok' })
    expect(findUnique).toHaveBeenCalledWith({ where: { provider: 'moby' } })
  })

  it('falls back to JSON when DB has no row', async () => {
    findUnique.mockResolvedValue(null)
    writeFileSync(process.env.GMGN_SESSION_PATH!, JSON.stringify({ cookie: 'json-cookie' }))

    const result = await loadSessionToken<{ cookie: string }>('gmgn')

    expect(result).toEqual({ cookie: 'json-cookie' })
  })

  it('falls back to JSON when DB throws (never-throw)', async () => {
    findUnique.mockRejectedValue(new Error('db explosion'))
    writeFileSync(process.env.STOCKBIT_SESSION_PATH!, JSON.stringify({ accessToken: 'fallback-tok' }))

    const result = await loadSessionToken<{ accessToken: string }>('stockbit')

    expect(result).toEqual({ accessToken: 'fallback-tok' })
  })

  it('returns null when neither DB nor JSON has data', async () => {
    findUnique.mockResolvedValue(null)

    const result = await loadSessionToken('alphio')

    expect(result).toBeNull()
  })
})

describe('mirrorSessionTokenSync', () => {
  it('writes JSON synchronously and triggers DB save', async () => {
    upsert.mockResolvedValue({})
    mirrorSessionTokenSync('alphio', { accessToken: 'sync-tok', accessTokenExp: 1 })

    // JSON is written synchronously — available immediately.
    expect(existsSync(process.env.ALPHIO_SESSION_PATH!)).toBe(true)
    const file = readFileSync(process.env.ALPHIO_SESSION_PATH!, 'utf8')
    expect(JSON.parse(file)).toEqual({ accessToken: 'sync-tok', accessTokenExp: 1 })

    // DB save is fire-and-forget — let it flush.
    await new Promise((r) => setImmediate(r))
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})
