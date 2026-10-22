// Contract tests: sniper scan pipeline — injected deps, zero network.
// Covers dedupe, delivery gating (EXECUTE/WATCHLIST only), circuit lock,
// discovery failure isolation, and per-token error isolation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSniperScan, type SniperScanDeps } from './sniper-scan'
import type { SniperEnrichedToken } from './sniper-source'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sniper-seen-'))
  process.env.SNIPER_SEEN_PATH = join(dir, 'seen.json')
  // Kill-switch: prevent test fixtures (GOOD/REAL/COPYCAT) from polluting live DB
  process.env.SNIPER_SEEN_DB = 'off'
  // These tests exercise the scan pipeline (discover → audit → deliver), not
  // the execution gate, so open the gate and let the pipeline run.
  process.env.SNIPER_EXECUTE_ENABLED = 'true'
  // Policy D: default tests run under production default (watchlist is opt-in, blocked).
  // Explicitly delete so an ambient .env loaded by @/lib/db cannot leak.
  delete process.env.SNIPER_DELIVER_WATCHLIST
})

afterEach(() => {
    delete process.env.SNIPER_SEEN_PATH
  delete process.env.SNIPER_SEEN_DB
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
    bundlerSoldPercent: 100,
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

const RUGGED: MemeRiskAudit = { ...CLEAN, canMint: true, lpLockedPercent: 0.3 }

function deps(over: Partial<SniperScanDeps> = {}): SniperScanDeps {
  return {
    discover: async () => [tok('GOOD'), tok('BAD')],
    // Audits echo the queried contract back — an audit describing a
    // different mint is a foreign row and is discarded by the identity gate.
    audit: async (_chain, contract) => [
      contract === 'GOOD' ? { ...CLEAN, contract } : { ...RUGGED, contract },
    ],
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

describe('runSniperScan', () => {
  it('evaluates candidates and only delivers non-REJECT legs', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const res = await runSniperScan({ deliver: true }, deps({ deliver }))
    expect(res.scanned).toBe(2)
    expect(res.screened).toBe(1)
    expect(res.rejected).toBe(1)
    expect(res.delivered).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(1)
    const sent = deliver.mock.calls[0][0]
    // Policy E: delivered signal carries full evidence, not the short alert.
    expect(sent).toContain('HIGH-CONVICTION')
    expect(sent).toContain('GOOD')
    expect(sent).toContain('Output screening')
  })

  it('policy D: a clean screen WITHOUT smart-money confirmation is not delivered', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const d = deps({
      deliver,
      smartMoney: async (_chain, contract) => ({
        contract,
        chain: 'solana',
        buyers: [],
        walletsHolding: 0,
        byStatus: {},
        strongest: null,
        bullishHoldingUsd: null,
        ttlMs: 1000,
        source: 'fixture',
      }),
    })
    const res = await runSniperScan({ deliver: true }, d)
    expect(res.screened).toBe(0) // evaluator caps at WATCHLIST without confirmation
    expect(res.delivered).toBe(0) // ...and the tier gate agrees
    expect(deliver).not.toHaveBeenCalled()
    const good = res.decisions.find((x) => x.ticker === 'GOOD')
    expect(good?.status).toBe('WATCHLIST')
    expect(good?.tier).toBe('WATCHLIST')
  })

  it('policy D: a security failure is never delivered even with confirmation', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const res = await runSniperScan({ deliver: true }, deps({ deliver }))
    const bad = res.decisions.find((x) => x.ticker === 'BAD')
    expect(bad?.tier).toBe('REJECT')
    expect(res.delivered).toBe(1) // only GOOD went out
  })

  it('dedupes a contract within the seen TTL — evaluated, not re-pushed', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const d = deps({ deliver })
    await runSniperScan({ deliver: true }, d)
    const second = await runSniperScan({ deliver: true }, d)
    expect(second.scanned).toBe(2)
    // GOOD was marked seen (deliverable); BAD was REJECTed and stays
    // eligible, so only one contract dedupes on the second pass.
    expect(second.deduped).toBe(1)
    expect(second.delivered).toBe(0)
    expect(deliver).toHaveBeenCalledTimes(1)
    // The re-evaluated REJECT proves the point: its vol/mcap had 10 min to
    // mature instead of being pinned invisible for the whole seen-TTL.
    expect(second.decisions.find((x) => x.contract === 'GOOD')?.deduped).toBe(true)
    expect(second.decisions.find((x) => x.contract === 'BAD')?.deduped).toBe(false)
  })

  it('surfaces discovery failure as an error instead of throwing', async () => {
    const res = await runSniperScan(
      {},
      deps({ discover: async () => { throw new Error('boosts down') } }),
    )
    expect(res.scanned).toBe(0)
    expect(res.decisions).toEqual([])
    expect(res.errors.join(' ')).toContain('discovery: boosts down')
  })

  it('isolates one contract audit failure and continues the rest', async () => {
    const res = await runSniperScan(
      {},
      deps({
        discover: async () => [tok('GOOD'), tok('BOOM'), tok('RUG')],
        audit: async (_chain, contract) => {
          if (contract === 'BOOM') throw new Error('audit 500')
          return [
            contract === 'GOOD'
              ? { ...CLEAN, contract }
              : { ...RUGGED, contract },
          ]
        },
      }),
    )
    expect(res.scanned).toBe(3)
    expect(res.decisions).toHaveLength(2)
    expect(res.errors.join(' ')).toContain('audit 500')
    expect(res.screened + res.rejected).toBe(2)
  })

  it('never delivers when deliver is false', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const res = await runSniperScan({ deliver: false }, deps({ deliver }))
    expect(deliver).not.toHaveBeenCalled()
    expect(res.delivered).toBe(0)
    expect(res.screened).toBe(1) // still evaluated
  })

  it('surfaces a foreign-contract audit as a warning on the decision, not as trust', async () => {
    const res = await runSniperScan(
      {},
      deps({
        discover: async () => [tok('GOOD')],
        // GOOD's audit set carries an off-target row (a different mint's
        // clean facts) — the identity gate must drop it and say so.
        audit: async (_chain, contract) => [
          { ...CLEAN, contract },
          { ...CLEAN, contract: 'SOMETHING_ELSE', platform: 'birdeye' },
        ],
      }),
    )
    const [d] = res.decisions
    expect(d.auditsUsed).toEqual(['rugcheck'])
    expect(d.warnings.some((w) => w.includes('contract mismatch') && w.includes('birdeye'))).toBe(true)
  })

  it('collapses copycats with duplicate tickers, keeping only the most-trusted mint', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    // Two mints sharing ticker PEPE: REAL has 100k liquidity, SCAM has 5k
    const real = tok('REAL', { symbol: 'PEPE', liquidity: 100_000 })
    const scam = tok('SCAM', { symbol: '$PEPE', liquidity: 5_000 })
    const res = await runSniperScan(
      { deliver: true },
      deps({
        discover: async () => [real, scam],
        audit: async (_chain, contract) => [{ ...CLEAN, contract }],
        deliver,
      }),
    )
    // Only 1 candidate was evaluated and delivered: REAL won, SCAM dropped
    expect(res.scanned).toBe(1)
    expect(res.decisions).toHaveLength(1)
    expect(res.decisions[0].contract).toBe('REAL')
    expect(res.delivered).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('suppresses delivery of a copycat re-launch when ticker was already delivered under another contract', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    // Pass 1: deliver the authentic token
    const original = tok('ORIGINAL', { symbol: 'DOGE', liquidity: 50_000 })
    const d = deps({
      discover: async () => [original],
      audit: async (_chain, contract) => [{ ...CLEAN, contract }],
      deliver,
    })
    const first = await runSniperScan({ deliver: true }, d)
    expect(first.delivered).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(1)

    // Pass 2: a copycat launches under a new contract but same ticker
    const copycat = tok('COPYCAT', { symbol: '$DOGE', liquidity: 80_000 })
    const second = await runSniperScan(
      { deliver: true },
      deps({
        discover: async () => [copycat],
        audit: async (_chain, contract) => [{ ...CLEAN, contract }],
        deliver,
      }),
    )
    // Evaluated, but delivery is suppressed by ticker seen state
    expect(second.delivered).toBe(0)
    expect(deliver).toHaveBeenCalledTimes(1) // Still 1 from pass 1
    expect(second.decisions[0].deduped).toBe(true)
  })
})
