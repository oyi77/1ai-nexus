// Contract tests: decision audit trail — change classification, per-contract
// chain, and the re-review set that opens the digest inside the seen-TTL.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendSniperAudit,
  auditTrailFor,
  classifyChange,
  materiallyChanged,
  readSniperAudit,
  accumulationReadings,
  type AuditEntry,
} from './sniper-audit'
import type { SniperScanDecision, SniperScanResult } from './sniper-scan'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sniper-audit-'))
  process.env.SNIPER_AUDIT_PATH = join(dir, 'audit.json')
})
afterEach(() => {

  delete process.env.SNIPER_AUDIT_PATH
  rmSync(dir, { recursive: true, force: true })
})

function decision(over: Partial<SniperScanDecision> = {}): SniperScanDecision {
  return {
    status: 'REJECT',
    rationale: 'r',
    rejections: ['mint authority on'],
    warnings: [],
    metrics: {
      ageMinutes: 12,
      ageLabel: '12m',
      stage: 'new-pair',
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
    alert: 'a',
    contract: 'mint111',
    ticker: 'TOK',
    deduped: false,
    delivered: false,
    auditsUsed: ['rugcheck'],
    tier: 'REJECT',
    tierReasons: [],
    tierMissing: [],
    smartMoneyBuyers: 0,
    smartMoneyStrongest: null,
    smartMoneySource: 'fixture',
    discoveryCategory: 'NEW_PAIRS',
    discoveryEvidence: [],
    market: { marketCapUsd: 50_000, liquidityUsd: 12_000, volume5mUsd: 4_000, priceUsd: 0.0005 },
    ...over,
  }
}

function result(decisions: SniperScanDecision[]): SniperScanResult {
  return {
    scanned: decisions.length,
    screened: 0,
    watchlisted: 0,
    rejected: decisions.length,
    deduped: 0,
    delivered: 0,
    decisions,
    errors: [],
    categories: {},
  }
}

function prev(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    contract: 'mint111',
    at: '2026-10-12T06:00:00.000Z',
    status: 'REJECT',
    tier: 'REJECT',
    delivered: false,
    deduped: false,
    rejectionCount: 1,
    marketCapUsd: 50_000,
    liquidityUsd: 12_000,
    change: 'NEW',
    previousStatus: null,
    ...over,
  }
}

describe('classifyChange', () => {
  it('labels a first sighting NEW', () => {
    expect(classifyChange(null, { status: 'REJECT', rejectionCount: 1, marketCapUsd: 1 })).toBe('NEW')
  })

  it('calls a steady verdict UNCHANGED', () => {
    expect(classifyChange(prev(), { status: 'REJECT', rejectionCount: 1, marketCapUsd: 55_000 })).toBe('UNCHANGED')
  })

  it('flags a status flip as MATERIAL', () => {
    expect(classifyChange(prev(), { status: 'WATCHLIST', rejectionCount: 1, marketCapUsd: 50_000 })).toBe('MATERIAL')
  })

  it('flags a changed failure count as MATERIAL', () => {
    expect(classifyChange(prev(), { status: 'REJECT', rejectionCount: 3, marketCapUsd: 50_000 })).toBe('MATERIAL')
  })

  it('flags a market cap move beyond 25% as MATERIAL', () => {
    expect(classifyChange(prev(), { status: 'REJECT', rejectionCount: 1, marketCapUsd: 70_000 })).toBe('MATERIAL')
  })

  it('flags a number appearing or vanishing as MATERIAL', () => {
    expect(classifyChange(prev({ marketCapUsd: null }), { status: 'REJECT', rejectionCount: 1, marketCapUsd: 50_000 })).toBe('MATERIAL')
  })
})

describe('sniper-audit', () => {
  it('reads empty when the file is absent', () => {
    expect(readSniperAudit().entries).toEqual([])
  })

  it('records the first evaluation as NEW and a repeat as UNCHANGED', () => {
    appendSniperAudit(result([decision()]))
    const trail = auditTrailFor('mint111')
    expect(trail).toHaveLength(1)
    expect(trail[0].change).toBe('NEW')

    appendSniperAudit(result([decision()]))
    const after = auditTrailFor('mint111')
    expect(after).toHaveLength(2)
    expect(after[0].change).toBe('UNCHANGED') // in-memory read is the newest-first store
  })

  it('keeps newest-first and caps the trail', () => {
    for (let i = 0; i < 620; i++) appendSniperAudit(result([decision({ contract: `mint${i}` })]))
    const audit = readSniperAudit()
    expect(audit.entries).toHaveLength(500)
    expect(audit.entries[0].contract).toBe('mint619')
  })

  it('reads a corrupt file as empty and recovers on the next append', () => {
    writeFileSync(process.env.SNIPER_AUDIT_PATH!, '{ not json')
    expect(readSniperAudit().entries).toEqual([])
    const next = appendSniperAudit(result([decision({ contract: 'ccc' })]))
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0].contract).toBe('ccc')
  })

  it('materiallyChanged returns verdict flips only, not steady rows', () => {
    appendSniperAudit(result([decision({ contract: 'flip' }), decision({ contract: 'steady' })]))
    const changed = materiallyChanged(result([
      decision({ contract: 'flip', status: 'WATCHLIST', delivered: true, tier: 'WATCHLIST' }),
      decision({ contract: 'steady' }),
      decision({ contract: 'brandnew' }),
    ]))
    expect(changed.has('flip')).toBe(true)
    expect(changed.has('brandnew')).toBe(true) // first sighting == material
    expect(changed.has('steady')).toBe(false)
  })

  it('materiallyChanged flags a new failure count on the same verdict', () => {
    appendSniperAudit(result([decision({ contract: 'tok' })]))
    const changed = materiallyChanged(result([
      decision({ contract: 'tok', rejections: ['mint authority on', 'dev holding 14%'] }),
    ]))
    expect(changed.has('tok')).toBe(true)
  })

  it('auditTrailFor filters to one contract', () => {
    appendSniperAudit(result([decision({ contract: 'a' }), decision({ contract: 'b' })]))
    expect(auditTrailFor('a').map((e) => e.contract)).toEqual(['a'])
    expect(auditTrailFor('zzz')).toEqual([])
  })
})

describe('accumulationReadings', () => {
  it('skips entries with no distribution at all — the live crash shape', () => {
    // A trail written before distribution existed has NO `distribution` key.
    // `!== null` let `undefined` through and crashed on `.devPercent`.
    const legacy = prev() as AuditEntry
    delete (legacy as { distribution?: unknown }).distribution
    writeFileSync(
      process.env.SNIPER_AUDIT_PATH!,
      JSON.stringify({ entries: [legacy], updatedAt: null }),
    )
    expect(() => accumulationReadings('mint111')).not.toThrow()
    expect(accumulationReadings('mint111')).toEqual([])
  })

  it('skips an explicit null distribution', () => {
    writeFileSync(
      process.env.SNIPER_AUDIT_PATH!,
      JSON.stringify({ entries: [prev({ distribution: null })], updatedAt: null }),
    )
    expect(accumulationReadings('mint111')).toEqual([])
  })

  it('returns oldest-first for two real readings', () => {
    const dist = { devPercent: 0, sniperPercent: 1, bundlerPercent: 2, insiderPercent: 1, top10Percent: 10, clusterPercent: 1 }
    writeFileSync(
      process.env.SNIPER_AUDIT_PATH!,
      JSON.stringify({
        entries: [prev({ at: '2026-10-12T07:00:00.000Z', distribution: dist }), prev({ at: '2026-10-12T06:00:00.000Z', distribution: dist })],
        updatedAt: null,
      }),
    )
    expect(accumulationReadings('mint111').map((r) => r.at)).toEqual([
      '2026-10-12T06:00:00.000Z',
      '2026-10-12T07:00:00.000Z',
    ])
  })

  it('records the cohort exit ratio alongside the share it is read against', () => {
    const dist = { devPercent: 0, sniperPercent: 2, bundlerPercent: 3, bundlerSoldPercent: 60, insiderPercent: 1, top10Percent: 12, clusterPercent: 0.5 }
    appendSniperAudit(result([decision({ distribution: dist })]))
    expect(readSniperAudit().entries[0].distribution).toEqual(dist)
  })

  it('persists an unreported exit ratio as null, never as a full exit', () => {
    const dist = { devPercent: 0, sniperPercent: 2, bundlerPercent: null, insiderPercent: 1, top10Percent: 12, clusterPercent: 0.5 }
    appendSniperAudit(result([decision({ distribution: dist })]))
    const stored = readSniperAudit().entries[0].distribution
    expect(stored?.bundlerSoldPercent).toBeNull()
    expect(stored?.bundlerPercent).toBeNull()
  })
})
