// ─────────────────────────────────────────────────────────────
// Copy-Trading Leaderboard Module Tests
// Tests gate.io + hyperliquid normalizers against saved fixtures
// (no network); the fetch global is stubbed per URL.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import gateioModule from '../market/gateio-copy/leaderboard'
import hyperliquidModule from '../market/hyperliquid-copy/leaderboard'
import { _clearCaches } from '../fetch-with-cache'

import gateioFixture from './fixtures/gateio-leaderboard.json'
import hlFixture from './fixtures/hyperliquid-leaderboard.json'
interface LeaderRow {
  id: string
  platform: string
  nick: string
  level: number
  profit: number
  profitRate: number
  winRate: number
  maxDrawdown: number
  sharpe: number
  aum: number
  followers: number
  maxFollowers: number
  leadingDays: number
  plRatio: number
  isPrivate: boolean
  labels: string[]
  avatar: string | null
}
interface CopyResult {
  source: string
  timestamp: number
  ttl: number
  data: { leaders: LeaderRow[]; total: number }
}

// Keep the module's lazy Redis client out of tests (memory cache only).
vi.mock('../../redis', () => ({
  getRedisClient: () => null,
}))

function stubFetch(body: unknown) {
  const f = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response))
  vi.stubGlobal('fetch', f)
  return f
}

describe('Gate.io Copy-Trading Leaderboard (re)', () => {
  beforeEach(() => {
    _clearCaches()
    vi.unstubAllGlobals()
  })

  it('declares re provenance with the required contract', () => {
    expect(gateioModule.sourceType).toBe('re')
    expect(gateioModule.provenance.discoveredVia).toBe('devtools-network-tab')
    expect(gateioModule.provenance.fragility).toBe('fragile')
    expect(gateioModule.provenance.toleratesAbsence).toBe(true)
    expect(typeof gateioModule.fallbackFn).toBe('function')
    expect(gateioModule.isEnabled()).toBe(true)
  })

  it('normalizes leader rows from the gate.tv web API fixture', async () => {
    stubFetch(gateioFixture)
    const result = (await gateioModule.fetch({ cycle: 'month', page_size: 50, order_by: 'aum' })) as CopyResult;
    expect(result.data.leaders.length).toBe(5)
    expect(result.data.total).toBe(502) // dynamic data.totalcount, never hardcoded

    const top = result.data.leaders[0]
    expect(top.id).toBe('30809')
    expect(top.platform).toBe('gateio')
    expect(top.nick).toBe('Maple 1008')
    expect(top.level).toBe(5)
    expect(top.profit).toBeCloseTo(31359.91, 2)
    expect(top.profitRate).toBeCloseTo(0.3792, 4)
    expect(top.winRate).toBeCloseTo(0.9895, 4)
    expect(top.maxDrawdown).toBeCloseTo(0.0596, 4)
    expect(top.sharpe).toBeCloseTo(5.69, 2)
    expect(top.aum).toBeCloseTo(1804570.88, 2)
    expect(top.followers).toBe(989)
    expect(top.maxFollowers).toBe(1000)
    expect(top.leadingDays).toBe(52)
    expect(top.plRatio).toBeCloseTo(357.27, 2)
    expect(top.isPrivate).toBe(false)
    expect(top.labels).toEqual(['Long-term', 'High Frequency', 'Aggressive'])
    expect(top.avatar).toBeTruthy()
  })

  it('maps is_private_leader to isPrivate', async () => {
    stubFetch(gateioFixture)
    const result = (await gateioModule.fetch({ cycle: 'month' })) as CopyResult;
    expect(result.data.leaders[1].isPrivate).toBe(true)
  })

  it('returns the standard ModuleResult shape', async () => {
    stubFetch(gateioFixture)
    const result = (await gateioModule.fetch({ cycle: 'week' })) as CopyResult;
    expect(result.source).toContain('gateio-copy-leaderboard')
    expect(result.timestamp).toBeGreaterThan(0)
    expect(result.ttl).toBe(180_000) // TOKEN_DATA × RE_MULTIPLIER
  })
})

describe('Hyperliquid Copy-Trading Leaderboard (public-api)', () => {
  beforeEach(() => {
    _clearCaches()
    vi.unstubAllGlobals()
  })

  it('declares public-api provenance via community package', () => {
    expect(hyperliquidModule.sourceType).toBe('public-api')
    expect(hyperliquidModule.provenance.discoveredVia).toBe('community-package')
    expect(hyperliquidModule.provenance.fragility).toBe('stable')
    expect(hyperliquidModule.provenance.toleratesAbsence).toBe(true)
  })

  it('slices the dump to page_size and normalizes month performance', async () => {
    stubFetch(hlFixture)
    const result = (await hyperliquidModule.fetch({ cycle: 'month', page_size: 3 })) as CopyResult;
    expect(result.data.leaders.length).toBe(3)
    expect(result.data.total).toBe(5) // fixture row count

    const top = result.data.leaders[0]
    expect(top.platform).toBe('hyperliquid')
    expect(top.id).toBe('0xf5d81a135f756ca16544e53c20fc20643ec3ad53')
    expect(top.nick).toBe('0xf5d8…ad53') // displayName null → shortened address
    expect(top.avatar).toBeNull()
    expect(top.level).toBe(0)
    expect(top.labels).toEqual([])
    expect(top.winRate).toBe(0) // not provided by stats-data
    expect(top.followers).toBe(0)
    expect(top.profit).toBeCloseTo(-3092548.42, 2) // month pnl
    expect(top.profitRate).toBeCloseTo(-0.0336878433, 6) // month roi
    expect(top.aum).toBeCloseTo(60473235.09, 2) // accountValue
  })

  it('uses a long TTL mirroring the hourly dump refresh', async () => {
    stubFetch(hlFixture)
    const result = (await hyperliquidModule.fetch({ cycle: 'allTime', page_size: 1 })) as CopyResult;
    expect(result.ttl).toBe(3_600_000) // MACRO_DATA
    expect(result.data.leaders.length).toBe(1)
  })
})
