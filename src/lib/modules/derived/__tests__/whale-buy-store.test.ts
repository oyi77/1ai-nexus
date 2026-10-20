// ─────────────────────────────────────────────────────────────
// whale-buy-store tests — DB-primary + JSON dual-write, kill-switch.
//
// All tests run with WHALE_BUYS_DB=off (kill-switch) so the suite is
// hermetic — no live Postgres connection. JSON path overridden to a
// temp file to avoid polluting the working tree's data/ dir.
// Covers: save→load JSON roundtrip, empty save, load missing file,
// prune returns -1 when disabled, kill-switch behavior.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  saveWhaleBuys,
  loadWhaleBuys,
  pruneStaleWhaleBuys,
  isWhaleBuysDbDisabled,
  whaleBuysJsonPath,
  type WhaleBuyRow,
} from '../whale-buy-store'
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock prisma so the module never touches a real DB even if the
// kill-switch were to fail.
const mockUpsert = vi.fn()
const mockFindMany = vi.fn()
const mockDeleteMany = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    walletBuySignal: {
      upsert: (...a: unknown[]) => mockUpsert(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
      deleteMany: (...a: unknown[]) => mockDeleteMany(...a),
    },
  },
}))

const TMP_DIR = join(tmpdir(), 'whale-buy-store-test-' + process.pid)
const TMP_JSON = join(TMP_DIR, 'whale-buys-latest.json')

function row(over: Partial<WhaleBuyRow> = {}): WhaleBuyRow {
  return {
    contract: 'TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    chain: 'solana',
    buyers: ['WalletA111111111111111111111111111111111111'],
    buyVolumeUsd: 50_000,
    buyCount: 1,
    firstBuyAt: 1_700_000_000_000,
    lastBuyAt: 1_700_000_000_000,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WHALE_BUYS_DB = 'off'
  process.env.WHALE_BUYS_PATH = TMP_JSON
  // Clean any leftover temp file.
  try { rmSync(TMP_JSON, { force: true }) } catch { /* ignore */ }
})

afterEach(() => {
  try { rmSync(TMP_JSON, { force: true }) } catch { /* ignore */ }
})

describe('whale-buy-store kill-switch', () => {
  it('isWhaleBuysDbDisabled returns true when WHALE_BUYS_DB=off', () => {
    process.env.WHALE_BUYS_DB = 'off'
    expect(isWhaleBuysDbDisabled()).toBe(true)
  })

  it('isWhaleBuysDbDisabled returns false when WHALE_BUYS_DB is unset', () => {
    delete process.env.WHALE_BUYS_DB
    expect(isWhaleBuysDbDisabled()).toBe(false)
  })
})

describe('whale-buy-store save + load (JSON with kill-switch)', () => {
  it('saves and loads whale-buy rows via JSON roundtrip', async () => {
    await saveWhaleBuys([row(), row({ contract: 'SecondTokenMintBBBBBBBBBBBBBBBBBBBBBBBBBBB' })])

    const loaded = await loadWhaleBuys()
    expect(loaded).toHaveLength(2)
    expect(loaded[0].contract).toBe('TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(loaded[0].buyers).toEqual(['WalletA111111111111111111111111111111111111'])
    expect(loaded[0].buyVolumeUsd).toBe(50_000)
  })

  it('merges successive saves instead of clobbering earlier candidates', async () => {
    // The cron calls saveWhaleBuys with only the NEW rows of each pass. A
    // plain overwrite would shrink the artifact to the latest pass and make
    // the JSON a partial view of the DB (observed: 5 DB rows, 1 artifact row).
    await saveWhaleBuys([row({ contract: 'FirstToken' })])
    await saveWhaleBuys([row({ contract: 'SecondToken' })])

    const loaded = await loadWhaleBuys()
    expect(loaded.map((r) => r.contract).sort()).toEqual(['FirstToken', 'SecondToken'])
  })

  it('replaces the row for a re-saved contract rather than duplicating it', async () => {
    await saveWhaleBuys([row({ contract: 'SameToken', buyVolumeUsd: 1_000 })])
    await saveWhaleBuys([row({ contract: 'SameToken', buyVolumeUsd: 9_000 })])

    const loaded = await loadWhaleBuys()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].buyVolumeUsd).toBe(9_000)
  })

  it('writes the JSON artifact to the configured path', async () => {
    await saveWhaleBuys([row()])
    expect(existsSync(whaleBuysJsonPath())).toBe(true)
  })

  it('returns [] when loading a missing file', async () => {
    delete process.env.WHALE_BUYS_PATH
    // Point to a path that doesn't exist.
    process.env.WHALE_BUYS_PATH = join(TMP_DIR, 'nonexistent.json')
    const loaded = await loadWhaleBuys()
    expect(loaded).toEqual([])
  })

  it('saves empty rows and writes an empty candidates JSON (no DB calls)', async () => {
    await saveWhaleBuys([])
    // JSON dual-write happens before the empty check — an empty artifact is written.
    expect(existsSync(whaleBuysJsonPath())).toBe(true)
    // But no DB upsert calls are made.
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('load falls back to JSON when DB has no rows', async () => {
    // Seed the JSON file directly with a valid artifact.
    mkdirSync(dirname(TMP_JSON), { recursive: true })
    writeFileSync(
      TMP_JSON,
      JSON.stringify({
        generated_at: '2026-10-16T00:00:00Z',
        source: 'whale-buy-scanner',
        candidates: [row()],
      }),
      'utf8',
    )
    // DB enabled but returns empty → falls back to JSON.
    process.env.WHALE_BUYS_DB = 'on'
    mockFindMany.mockResolvedValue([])

    const loaded = await loadWhaleBuys()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].contract).toBe('TokenMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  })

  it('load returns DB rows when DB has data', async () => {
    process.env.WHALE_BUYS_DB = 'on'
    mockFindMany.mockResolvedValue([
      {
        contract: 'DbTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        chain: 'solana',
        buyVolumeUsd: 99_000,
        buyCount: 3,
        firstBuyAt: new Date(1_700_000_000_000),
        lastBuyAt: new Date(1_700_000_001_000),
        buyers: ['DbWallet11111111111111111111111111111111111'],
      },
    ])

    const loaded = await loadWhaleBuys()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].contract).toBe('DbTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(loaded[0].buyVolumeUsd).toBe(99_000)
    expect(loaded[0].buyCount).toBe(3)
    expect(loaded[0].buyers).toEqual(['DbWallet11111111111111111111111111111111111'])
    expect(loaded[0].firstBuyAt).toBe(1_700_000_000_000)
    expect(loaded[0].lastBuyAt).toBe(1_700_000_001_000)
  })
})

describe('whale-buy-store pruneStaleWhaleBuys', () => {
  it('returns -1 when kill-switch is on', async () => {
    process.env.WHALE_BUYS_DB = 'off'
    const deleted = await pruneStaleWhaleBuys(60)
    expect(deleted).toBe(-1)
  })

  it('returns the deleted count when DB is enabled', async () => {
    process.env.WHALE_BUYS_DB = 'on'
    mockDeleteMany.mockResolvedValue({ count: 5 })
    const deleted = await pruneStaleWhaleBuys(360)
    expect(deleted).toBe(5)
    expect(mockDeleteMany).toHaveBeenCalledTimes(1)
  })
})
