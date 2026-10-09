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
  // These tests exercise the scan pipeline (discover → audit → deliver), not
  // the execution gate, so open the gate and let the pipeline run.
  process.env.SNIPER_EXECUTE_ENABLED = 'true'
})

afterEach(() => {
  delete process.env.SNIPER_EXECUTE_ENABLED
  delete process.env.SNIPER_SEEN_PATH
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
  distribution: { devPercent: 0, sniperPercent: 0.005, bundlerPercent: 0.02, insiderPercent: 0.01 },
  topWallets: [{ address: 'H1', percent: 0.04 }],
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
    ...over,
  }
}

describe('runSniperScan', () => {
  it('evaluates candidates and only delivers non-REJECT legs', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const res = await runSniperScan({ deliver: true }, deps({ deliver }))
    expect(res.scanned).toBe(2)
    expect(res.executed).toBe(1)
    expect(res.rejected).toBe(1)
    expect(res.delivered).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(1)
    const sent = deliver.mock.calls[0][0]
    expect(sent).toContain('[🟢 EXECUTE SNIPE]')
    expect(sent).toContain('GOOD')
  })

  it('dedupes a contract within the seen TTL — evaluated, not re-pushed', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const d = deps({ deliver })
    await runSniperScan({ deliver: true }, d)
    const second = await runSniperScan({ deliver: true }, d)
    expect(second.scanned).toBe(2)
    expect(second.deduped).toBe(2)
    expect(second.delivered).toBe(0)
    expect(deliver).toHaveBeenCalledTimes(1)
    // Decisions still present (evaluation is cheap; delivery is the gate).
    expect(second.decisions.every((x) => x.deduped)).toBe(true)
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
          return [contract === 'GOOD' ? CLEAN : RUGGED]
        },
      }),
    )
    expect(res.scanned).toBe(3)
    expect(res.decisions).toHaveLength(2)
    expect(res.errors.join(' ')).toContain('audit 500')
    expect(res.executed + res.rejected).toBe(2)
  })

  it('never delivers when deliver is false', async () => {
    const deliver = vi.fn(async (_text: string) => true)
    const res = await runSniperScan({ deliver: false }, deps({ deliver }))
    expect(deliver).not.toHaveBeenCalled()
    expect(res.delivered).toBe(0)
    expect(res.executed).toBe(1) // still evaluated
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
})
