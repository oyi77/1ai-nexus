// ─────────────────────────────────────────────────────────────
// RugCheck adapter unit tests (fixture-backed, no network).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest'
import { auditRugcheckToken } from '../rugcheck'

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

afterEach(() => { vi.unstubAllGlobals() })

const REPORT = {
  mint: 'TestMint11111111111111111111111111111111111111',
  tokenMeta: { name: 'Test Token', symbol: 'TEST' },
  score: 68,
  totalHolders: 3400,
  totalMarketLiquidity: 50000,
  totalStableLiquidity: 20000,
  rugged: false,
  // Live shape is a NUMBER (0 when none found), not a boolean.
  graphInsidersDetected: 0,
  mintAuthority: null,
  freezeAuthority: 'FreezeAuth1111111111111111111111111111111111',
  topHolders: [
    { address: 'Holder1', pct: 25, balance: 1000 },
    { address: 'Holder2', pct: 15, balance: 600 },
  ],
  risks: [{ name: 'High Concentration', value: '25%', description: 'Top holder 25%', score: 20 }],
}

describe('auditRugcheckToken', () => {
  it('maps score 68 to riskLevel 2 (middle) with correct counts', async () => {
    mockFetchOnce(200, REPORT)
    const audit = await auditRugcheckToken('solana', 'TestMint')
    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('rugcheck')
    expect(audit!.riskLevel).toBe(2)
    expect(audit!.riskLabel).toBe('middle')
    expect(audit!.riskCounts).toEqual({ high: 1, middle: 0, low: 0 })
    expect(audit!.top10HolderPercent).toBeCloseTo(0.4) // 25% + 15%
    expect(audit!.canFreeze).toBe(true)
    expect(audit!.canMint).toBe(false)
    expect(audit!.symbol).toBe('TEST')
    expect(audit!.name).toBe('Test Token')
  })

  it('returns null on upstream failure', async () => {
    mockFetchOnce(500, {})
    expect(await auditRugcheckToken('solana', 'addr')).toBeNull()
  })

  it('handles score 0 as safe', async () => {
    mockFetchOnce(200, { ...REPORT, score: 0 })
    const audit = await auditRugcheckToken('solana', 'addr')
    expect(audit).not.toBeNull()
    expect(audit!.riskLevel).toBe(0)
    expect(audit!.riskLabel).toBe('safe')
  })

  it('reads a clean bubblemap as proven-zero cluster, not unproven', async () => {
    // Live-proven 2026-10-11: no cluster -> insiderNetworks null +
    // graphInsidersDetected 0. That is a completed analysis with zero
    // findings; treating it as unproven rejected every clean token.
    mockFetchOnce(200, {
      ...REPORT,
      token: { supply: 1_000_000 },
      creatorBalance: 0,
      graphInsidersDetected: 0,
      insiderNetworks: null,
    })
    const audit = await auditRugcheckToken('solana', 'addr')
    expect(audit!.distribution?.clusterPercent).toBe(0)
    expect(audit!.distribution?.insiderPercent).toBe(0)
  })

  it('reads a detected cluster share from insiderNetworks', async () => {
    mockFetchOnce(200, {
      ...REPORT,
      token: { supply: 1_000_000 },
      creatorBalance: 0,
      graphInsidersDetected: 4,
      insiderNetworks: [{ currentHolding: 50_000 }],
    })
    const audit = await auditRugcheckToken('solana', 'addr')
    expect(audit!.distribution?.clusterPercent).toBeCloseTo(0.05)
  })

  it('leaves cluster unproven when the analysis never ran', async () => {
    mockFetchOnce(200, {
      ...REPORT,
      token: { supply: 1_000_000 },
      creatorBalance: 0,
      graphInsidersDetected: undefined,
      insiderNetworks: null,
    })
    const audit = await auditRugcheckToken('solana', 'addr')
    expect(audit!.distribution?.clusterPercent).toBeUndefined()
  })
})