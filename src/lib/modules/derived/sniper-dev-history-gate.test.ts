// ─────────────────────────────────────────────────────────────
// Contract tests: dev-history rejection gate wired into the sniper scan.
//
// Fixture-backed, zero network. The gate is opt-in
// (SNIPER_DEV_HISTORY_GATE="true"); OFF must leave the existing pipeline
// untouched (no dev-tokens calls, existing decisions byte-identical).
// UNPROVEN passes by design: a brand-new dev is unjudged, not guilty —
// only a PROVEN bad history (SERIAL_RUGGER) rejects here.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runSniperScan,
  __resetDevHistoryMemoForTests,
  type SniperScanDeps,
} from './sniper-scan'
import type { SniperEnrichedToken } from './sniper-source'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'
import type { DevHistoryVerdict } from './dev-history'
import { assessDevHistory, type DevHistoryInput, type DevHistoryToken } from './dev-history'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sniper-devgate-'))
  process.env.SNIPER_SEEN_PATH = join(dir, 'seen.json')
  process.env.SNIPER_SEEN_DB = 'off'
  process.env.SNIPER_EXECUTE_ENABLED = 'true'
  delete process.env.SNIPER_DEV_HISTORY_GATE
})

afterEach(() => {
  delete process.env.SNIPER_SEEN_PATH
  delete process.env.SNIPER_SEEN_DB
  delete process.env.SNIPER_EXECUTE_ENABLED
  delete process.env.SNIPER_DEV_HISTORY_GATE
  __resetDevHistoryMemoForTests()
  rmSync(dir, { recursive: true, force: true })
})

function tok(contract: string, over: Partial<SniperEnrichedToken> = {}): SniperEnrichedToken {
  return {
    id: `solana:${contract}`,
    platform: 'dexscreener',
    chain: 'solana',
    contract,
    symbol: contract,
    name: contract,
    price: 0,
    change24h: 0,
    volume24h: 0,
    marketCap: 1_000_000,
    liquidity: 50_000,
    createdAt: Date.now() - 30 * 60_000,
    riskLevel: 0,
    holders: 0,
    top10HolderPercent: 0,
    social: {},
    audited: false,
    volume5m: 3_000_000,
    ...over,
  }
}

const CLEAN: MemeRiskAudit = {
  id: 'x',
  platform: 'rugcheck',
  chain: 'solana',
  contract: '',
  symbol: '',
  name: '',
  riskLevel: 0,
  riskLabel: 'safe',
  buyTax: 0,
  sellTax: 0,
  top10HolderPercent: 0.15,
  lpLockedPercent: 1,
  canFreeze: false,
  canMint: false,
  isHoneypot: false,
  riskCounts: { high: 0, middle: 0, low: 0 },
  // All distribution legs proven clean (fractions 0..1) — unknown would
  // be unproven and the evaluator would (correctly) REJECT.
  distribution: {
    devPercent: 0,
    sniperPercent: 0.005,
    bundlerPercent: 0.02,
    insiderPercent: 0.01,
    clusterPercent: 0.01,
  },
  topWallets: [
    { address: 'H1', percent: 0.04 },
    { address: 'H2', percent: 0.03 },
    { address: 'H3', percent: 0.02 },
  ],
  top5AvgPnlPercent: 20,
  auditedAt: Date.now(),
}

function deps(over: Partial<SniperScanDeps> = {}): SniperScanDeps {
  return {
    discover: async () => [tok('GOOD')],
    audit: async (_chain, contract) => [{ ...CLEAN, contract }],
    deliver: vi.fn(async () => true),
    smartMoney: async (_chain, contract) => ({
      contract,
      chain: 'solana',
      buyers: [
        {
          walletId: 'w1',
          address: 'Buyer1',
          alias: null,
          status: 'QUALIFIED_SMART_MONEY',
          pnl30d: 1.5,
          winRate: 0.7,
          sampleCount: 22,
          classifiedAt: new Date(),
          holdingUsd: 4000,
          stale: false,
        },
      ],
      walletsHolding: 1,
      byStatus: { QUALIFIED_SMART_MONEY: 1 },
      strongest: 'QUALIFIED_SMART_MONEY',
      bullishHoldingUsd: 4000,
      ttlMs: 1000,
      source: 'fixture',
    }),
    ...over,
  }
}

// ── Verdict fixtures (built via the PURE classifier) ──

function devTokens(n: number, opts: Partial<DevHistoryToken> = {}): DevHistoryToken[] {
  return Array.from({ length: n }, (_, i) => ({
    tokenAddress: `TOKN-${i + 1}`,
    migrated: false,
    migrationPct: 0,
    ...opts,
  }))
}

// 209 judged deploys with zero migrations: (69/70)^209 ≈ 4.9%, the first
// sample size that clears the default 5% binomial bar. Three zeros do not.
const SERIAL_RUGGER: DevHistoryVerdict = assessDevHistory({
  devAddress: 'DEV',
  tokens: devTokens(209),
} satisfies DevHistoryInput)

const CLEAN_DEV: DevHistoryVerdict = assessDevHistory({
  devAddress: 'DEV',
  tokens: devTokens(1, { migrated: true, migrationPct: 100 }),
} satisfies DevHistoryInput)

const UNPROVEN_DEV: DevHistoryVerdict = assessDevHistory({
  devAddress: null,
  tokens: [],
} satisfies DevHistoryInput)

describe('dev-history gate (SNIPER_DEV_HISTORY_GATE)', () => {
  it('OFF by default: dev-tokens classifier is never consulted', async () => {
    const devHistory = vi.fn(async () => SERIAL_RUGGER)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await runSniperScan({ deliver: true }, deps({ devHistory }))
    expect(res.scanned).toBe(1)
    expect(res.screened).toBe(1) // existing behavior intact
    expect(devHistory).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('ON + SERIAL_RUGGER verdict → REJECT with dev_serial_scammer code, no audit calls', async () => {
    process.env.SNIPER_DEV_HISTORY_GATE = 'true'
    const devHistory = vi.fn(async () => SERIAL_RUGGER)
    const audit = vi.fn(async (_chain: string, contract: string) => [{ ...CLEAN, contract }])
    const res = await runSniperScan({ deliver: true }, deps({ devHistory, audit }))
    expect(res.rejected).toBe(1)
    expect(res.screened).toBe(0)
    const d = res.decisions.find((x) => x.contract === 'GOOD')
    expect(d?.status).toBe('REJECT')
    expect(d?.rejections[0]).toContain('dev_serial_scammer')
    expect(d?.rejections[0]).toContain('[dev-history]')
    expect(d?.rationale).toContain('dev_serial_scammer')
    // Pre-gate: the audit fan-out must never run for a doomed candidate.
    expect(audit).not.toHaveBeenCalled()
    expect(devHistory).toHaveBeenCalledTimes(1)
  })

  it('ON + CLEAN verdict → passes through to the normal pipeline', async () => {
    process.env.SNIPER_DEV_HISTORY_GATE = 'true'
    const devHistory = vi.fn(async () => CLEAN_DEV)
    const audit = vi.fn(async (_chain: string, contract: string) => [{ ...CLEAN, contract }])
    const res = await runSniperScan({ deliver: true }, deps({ devHistory, audit }))
    expect(res.screened).toBe(1)
    expect(res.rejected).toBe(0)
    const d = res.decisions.find((x) => x.contract === 'GOOD')
    expect(d?.status).toBe('SIGNAL')
    expect(d?.rejections).toEqual([])
    expect(audit).toHaveBeenCalledTimes(1) // normal pipeline ran
  })

  it('ON + fetch failure (UNPROVEN) → does NOT reject: a brand-new dev is unjudged, not guilty', async () => {
    // UNPROVEN means "no deploy history to judge" (fresh dev or endpoint
    // outage). Rejecting on absent evidence would violate the pipeline's
    // core discipline: missing data never reads as a breach — the token's
    // own security/momentum gates carry that burden instead.
    process.env.SNIPER_DEV_HISTORY_GATE = 'true'
    const devHistory = vi.fn(async () => UNPROVEN_DEV)
    const res = await runSniperScan({ deliver: true }, deps({ devHistory }))
    expect(res.rejected).toBe(0)
    expect(res.screened).toBe(1)
    const d = res.decisions.find((x) => x.contract === 'GOOD')
    expect(d?.status).toBe('SIGNAL')
    expect(d?.rejections).toEqual([])
  })

  it('memo cache: two DISTINCT contracts each get one fetch (cache keyed per lookup)', async () => {
    process.env.SNIPER_DEV_HISTORY_GATE = 'true'
    // The memo key is (chain, contract) — the token being screened. Two
    // different mints are two keys even when the underlying dev is the
    // same person (the dev-tokens endpoint resolves that); each key is
    // fetched exactly once.
    const devHistory = vi.fn(async () => SERIAL_RUGGER)
    const res = await runSniperScan(
      { deliver: false },
      deps({
        devHistory,
        discover: async () => [tok('TOKA'), tok('TOKB')],
        audit: async (_chain, contract) => [{ ...CLEAN, contract }],
      }),
    )
    expect(res.rejected).toBe(2)
    expect(devHistory).toHaveBeenCalledTimes(2)
  })

  it('memo cache: re-scanning the same contract within TTL does not re-fetch', async () => {
    process.env.SNIPER_DEV_HISTORY_GATE = 'true'
    const devHistory = vi.fn(async () => SERIAL_RUGGER)
    const d = deps({ devHistory, discover: async () => [tok('TOKA')] })
    await runSniperScan({ deliver: false }, d)
    await runSniperScan({ deliver: false }, d)
    // Same contract, same pass window (TTL 30 min) → the memo cache serves
    // the second pass without calling the classifier again.
    expect(devHistory).toHaveBeenCalledTimes(1)
  })

  it('gate ON but no devHistory dep → skips the gate without crashing', async () => {
    process.env.SNIPER_DEV_HISTORY_GATE = 'true'
    const res = await runSniperScan({ deliver: true }, deps())
    expect(res.scanned).toBe(1)
    expect(res.screened).toBe(1)
  })
})
