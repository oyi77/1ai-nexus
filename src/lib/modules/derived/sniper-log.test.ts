// Contract tests: sniper decision log — ring buffer, counts, corruption safety.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendSniperScan, readSniperLog, sniperLogCounts } from './sniper-log'
import type { SniperScanDecision, SniperScanResult } from './sniper-scan'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sniper-log-'))
  process.env.SNIPER_LOG_PATH = join(dir, 'log.json')
})

afterEach(() => {
  delete process.env.SNIPER_LOG_PATH
  rmSync(dir, { recursive: true, force: true })
})

function decision(contract: string, status: SniperScanDecision['status']): SniperScanDecision {
  return {
    status,
    rationale: `${contract} ${status}`,
    rejections: status === 'REJECT' ? ['mint authority on'] : [],
    warnings: [],
    metrics: {
      stage: 'new-pair',
      ageMinutes: 12,
      ageLabel: '12m',
      stageLabel: 'New pair',
      volMcRatio: 3,
      requiredRatio: 2,
      devPercent: 0,
      sniperPercent: 1,
      bundlerPercent: 2,
      insiderPercent: 1,
      top10Percent: 10,
      clusterPercent: 1,
      avgPnlPercent: 40,
      pnlAssessment: 'neutral',
    },
    alert: `alert for ${contract}`,
    contract,
    ticker: contract.toUpperCase(),
    deduped: false,
    delivered: status !== 'REJECT',
    auditsUsed: ['rugcheck', 'birdeye'],
    tier: status === 'REJECT' ? 'REJECT' : 'HIGH_CONVICTION',
    tierReasons: ['fixture'],
    tierMissing: [],
    smartMoneyBuyers: 1,
    smartMoneyStrongest: 'QUALIFIED_SMART_MONEY',
    smartMoneySource: 'fixture',
    discoveryCategory: 'NEW_PAIRS',
    discoveryEvidence: [
      { provider: 'dexscreener', category: 'NEW_PAIRS', discoveredAt: 1_700_000_000_000 },
    ],
    market: { marketCapUsd: 50_000, liquidityUsd: 12_000, volume5mUsd: 4_000, priceUsd: 0.0005 },
  }
}

function result(decisions: SniperScanDecision[]): SniperScanResult {
  return {
    scanned: decisions.length,
    screened: decisions.filter((d) => d.status === 'SIGNAL').length,
    watchlisted: decisions.filter((d) => d.status === 'WATCHLIST').length,
    rejected: decisions.filter((d) => d.status === 'REJECT').length,
    deduped: 0,
    delivered: decisions.filter((d) => d.delivered).length,
    decisions,
    errors: [],
    categories: {},
  }
}

describe('sniper-log', () => {
  it('reads an empty log when the file is absent', () => {
    const log = readSniperLog()
    expect(log.entries).toEqual([])
    expect(log.updatedAt).toBeNull()
    expect(sniperLogCounts(log)).toEqual({ SIGNAL: 0, WATCHLIST: 0, REJECT: 0, total: 0 })
  })

  it('persists decisions newest-first and strips the Telegram alert body', () => {
    appendSniperScan(result([decision('aaa', 'SIGNAL')]))
    const log = appendSniperScan(result([decision('bbb', 'REJECT')]))

    expect(log.entries.map((e) => e.contract)).toEqual(['bbb', 'aaa'])
    expect(log.entries.some((e) => 'alert' in e)).toBe(false)
    expect(sniperLogCounts(log)).toEqual({ SIGNAL: 1, WATCHLIST: 0, REJECT: 1, total: 2 })
    expect(log.lastScan?.scanned).toBe(1)
    expect(log.updatedAt).not.toBeNull()
  })

  it('survives a corrupt file by reading it as empty', () => {
    writeFileSync(process.env.SNIPER_LOG_PATH!, '{ not json')
    const log = readSniperLog()
    expect(log.entries).toEqual([])
    // A later append still works and replaces the corrupt file.
    const next = appendSniperScan(result([decision('ccc', 'WATCHLIST')]))
    expect(next.entries).toHaveLength(1)
  })

  it('caps the ring buffer at 200 entries', () => {
    for (let i = 0; i < 210; i++) {
      appendSniperScan(result([decision(`tok${i}`, 'REJECT')]))
    }
    const log = readSniperLog()
    expect(log.entries).toHaveLength(200)
    expect(log.entries[0].contract).toBe('tok209')
  })

  it('normalises legacy rows whose ratio was never measured instead of crashing the reader', () => {
    const bad = {
      ...decision('legacy', 'REJECT'),
      metrics: { ...decision('legacy', 'REJECT').metrics, volMcRatio: null },
    } as unknown as SniperScanDecision
    const nan = {
      ...decision('nanrow', 'REJECT'),
      metrics: { ...decision('nanrow', 'REJECT').metrics, volMcRatio: NaN },
    } as unknown as SniperScanDecision
    const junk = [null, 'string', 42, { noContract: true }]

    writeFileSync(
      process.env.SNIPER_LOG_PATH!,
      JSON.stringify({ entries: [bad, nan, ...junk], updatedAt: null, lastScan: null }),
    )
    const log = readSniperLog()

    // Rows without a contract are dropped; the rest survive with an unknown ratio.
    expect(log.entries.map((e) => e.contract)).toEqual(['legacy', 'nanrow'])
    expect(log.entries[0].metrics.volMcRatio).toBeNull()
    expect(log.entries[1].metrics.volMcRatio).toBeNull()
  })
})
