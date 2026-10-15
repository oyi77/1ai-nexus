// ─────────────────────────────────────────────────────────────
// Trenches discovery provider unit tests (pure — the solpump trenches
// module is mocked, so no network and no env-dependent fetch).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as trenches from '@/lib/modules/meme/solpump/trenches'
import type { SolpumpTrenchToken } from '@/lib/modules/meme/solpump/trenches'

vi.mock('@/lib/modules/meme/solpump/trenches', async () => {
  const actual = await vi.importActual<typeof trenches>(
    '@/lib/modules/meme/solpump/trenches',
  )
  return {
    ...actual,
    fetchSolpumpTrenches: vi.fn(),
  }
})

import {
  fetchSolpumpTrenches,
  isGraduatingSweetSpot,
} from '@/lib/modules/meme/solpump/trenches'
import {
  discoverTrenches,
  trenchTokenToCandidate,
  trenchesGateOn,
} from '../discover-trenches'

const mockFetch = vi.mocked(fetchSolpumpTrenches)

/** PumpFun token at 92% bonding progress — sweet spot ([85,100)). */
function sweetSpot(over: Partial<SolpumpTrenchToken> = {}): SolpumpTrenchToken {
  return {
    chain: 'solana',
    pairAddress: 'PAIR1',
    tokenAddress: 'Mint11111111111111111111111111111111111111',
    tokenName: 'Sweet Token',
    tokenSymbol: 'SWEET',
    platformType: 'PUMPFUN',
    launchPad: { bondingCurve: { state: 'Migrating', progressPct: 92.1 } },
    rugged: false,
    createdAtAgeSeconds: 600,
    ...over,
  }
}

/** PumpFun token at 50% — too early, filtered out. */
function earlyToken(): SolpumpTrenchToken {
  return sweetSpot({
    tokenAddress: 'Early1111111111111111111111111111111111111',
    tokenSymbol: 'EARLY',
    launchPad: { bondingCurve: { state: 'Bonding', progressPct: 50 } },
  })
}

const ENV_KEYS = ['SOLPUMP_TRENCHES_ENABLED', 'SNIPER_TRENCHES_DISCOVERY'] as const

beforeEach(() => {
  mockFetch.mockReset()
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

function gateOn(): void {
  process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
  process.env.SNIPER_TRENCHES_DISCOVERY = 'true'
}

describe('trenchesGateOn', () => {
  it('is on only when BOTH flags are the literal "true" (double opt-in)', () => {
    expect(trenchesGateOn()).toBe(false)
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    expect(trenchesGateOn()).toBe(false)
    process.env.SNIPER_TRENCHES_DISCOVERY = 'true'
    expect(trenchesGateOn()).toBe(true)
    process.env.SOLPUMP_TRENCHES_ENABLED = '1'
    expect(trenchesGateOn()).toBe(false)
  })
})

describe('discoverTrenches', () => {
  it('returns [] WITHOUT calling fetch when either gate is off', async () => {
    // Neither flag set.
    await expect(discoverTrenches()).resolves.toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
    // Fetch flag on, sniper gate off — still no fetch.
    process.env.SOLPUMP_TRENCHES_ENABLED = 'true'
    await expect(discoverTrenches()).resolves.toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
    // Sniper gate on, fetch flag off — still no fetch.
    delete process.env.SOLPUMP_TRENCHES_ENABLED
    process.env.SNIPER_TRENCHES_DISCOVERY = 'true'
    await expect(discoverTrenches()).resolves.toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps only sweet-spot rows and keeps the correct candidate shape', async () => {
    gateOn()
    mockFetch.mockResolvedValue([sweetSpot(), earlyToken(), sweetSpot({ rugged: true })])
    const out = await discoverTrenches()
    expect(mockFetch).toHaveBeenCalledWith('graduating')
    expect(out).toHaveLength(1)
    const c = out[0]
    expect(c.contract).toBe('Mint11111111111111111111111111111111111111')
    expect(c.chain).toBe('solana')
    expect(c.symbol).toBe('SWEET')
    expect(c.name).toBe('Sweet Token')
    expect(c.platform).toBe('solpump')
    expect(c.id).toBe('solana:Mint11111111111111111111111111111111111111')
    // Age derived from createdAtAgeSeconds (600s ago) — bounded, never exact.
    expect(c.createdAt).not.toBeNull()
    expect(Date.now() - (c.createdAt as number)).toBeGreaterThanOrEqual(600_000)
    expect(Date.now() - (c.createdAt as number)).toBeLessThan(600_000 + 5_000)
    // Market data is UNKNOWN (trenches API does not report it) — never fabricated.
    expect(c.marketCap).toBe(0)
    expect(c.liquidity).toBe(0)
    expect(c.volume5m).toBeNull()
  })

  it('attaches discovery evidence in the CandidateEvidence shape (BONDING category)', async () => {
    gateOn()
    mockFetch.mockResolvedValue([sweetSpot()])
    const [c] = await discoverTrenches()
    expect(c.discoveryEvidence).toHaveLength(1)
    const ev = c.discoveryEvidence![0]
    // CandidateEvidence required fields.
    expect(typeof ev.provider).toBe('string')
    expect(typeof ev.category).toBe('string')
    expect(typeof ev.discoveredAt).toBe('number')
    // Provider-specific provenance.
    expect(ev.provider).toBe('solpump-trenches')
    expect(ev.note).toContain('bonding')
    expect(ev.note).toContain('92.1%')
    // categoryFor derives BONDING from the bonding note (not NEW_PAIRS).
    expect(ev.category).toBe('BONDING')
    expect(c.provenance?.provider).toBe('solpump')
    expect(c.provenance?.sourceType).toBe('public-api')
  })

  it('returns [] when the fetch rejects (no throw)', async () => {
    gateOn()
    mockFetch.mockRejectedValue(new Error('network down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(discoverTrenches()).resolves.toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('trenches discovery failed'))
    } finally {
      warn.mockRestore()
    }
  })

  it('respects the limit cap', async () => {
    gateOn()
    const many = Array.from({ length: 6 }, (_, i) =>
      sweetSpot({
        tokenAddress: `Mint${i}${'1'.repeat(30)}`,
        tokenSymbol: `T${i}`,
      }),
    )
    mockFetch.mockResolvedValue(many)
    await expect(discoverTrenches(4)).resolves.toHaveLength(4)
    mockFetch.mockResolvedValue(many)
    await expect(discoverTrenches()).resolves.toHaveLength(6)
  })

  it('isGraduatingSweetSpot stays the pure classifier (re-export sanity)', () => {
    expect(isGraduatingSweetSpot(sweetSpot())).toBe(true)
    expect(isGraduatingSweetSpot(earlyToken())).toBe(false)
  })
})

describe('trenchTokenToCandidate (pure mapper)', () => {
  it('nulls createdAt when age is missing or malformed', () => {
    expect(trenchTokenToCandidate(sweetSpot({ createdAtAgeSeconds: undefined })).createdAt).toBeNull()
    expect(trenchTokenToCandidate(sweetSpot({ createdAtAgeSeconds: -5 })).createdAt).toBeNull()
  })

  it('emits a placeholder "?" note when progress is missing', () => {
    const c = trenchTokenToCandidate(sweetSpot({ launchPad: undefined }))
    expect(c.discoveryEvidence?.[0]?.note).toContain('?%')
  })
})
