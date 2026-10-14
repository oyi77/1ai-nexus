import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PHASE_COOLDOWN_MS,
  MAX_PHASE_ENTRIES,
  persistAccumulationPhases,
  readSniperPhaseLog,
  shouldEmitPhase,
  type SniperPhaseEntry,
} from '../sniper-phase'
import type { SniperAudit } from '../sniper-audit'
import { ACCUMULATION_DEFAULTS, classifyAccumulation } from '../sniper-accumulation'

let dir: string

function phasePath(): string {
  return join(dir, 'sniper-phase.json')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sniper-phase-'))
  process.env.SNIPER_PHASE_PATH = phasePath()
})

afterEach(() => {
  delete process.env.SNIPER_PHASE_PATH
  delete process.env.SNIPER_PHASE_COOLDOWN_MS
  rmSync(dir, { recursive: true, force: true })
})

function auditWith(contract: string, firstDev: number, lastDev: number): SniperAudit {
  return {
    updatedAt: new Date().toISOString(),
    entries: [
      // Stored newest-first, matching appendSniperAudit.
      {
        contract,
        at: new Date(Date.now() - 1000).toISOString(),
        status: 'WATCHLIST',
        tier: 'WATCHLIST',
        delivered: false,
        deduped: false,
        rejectionCount: 0,
        marketCapUsd: 100_000,
        liquidityUsd: 50_000,
        change: 'MATERIAL',
        previousStatus: 'REJECT',
        distribution: {
          devPercent: lastDev,
          sniperPercent: 0,
          bundlerPercent: 0,
          insiderPercent: 0,
          top10Percent: 40,
          clusterPercent: 20,
        },
      },
      {
        contract,
        at: new Date(Date.now() - 2000).toISOString(),
        status: 'REJECT',
        tier: 'REJECT',
        delivered: false,
        deduped: false,
        rejectionCount: 1,
        marketCapUsd: 100_000,
        liquidityUsd: 50_000,
        change: 'NEW',
        previousStatus: null,
        distribution: {
          devPercent: firstDev,
          sniperPercent: 0,
          bundlerPercent: 0,
          insiderPercent: 0,
          top10Percent: 40,
          clusterPercent: 20,
        },
      },
    ],
  }
}

describe('sniper-phase log (fs isolation)', () => {
  it('reads a missing file as empty', () => {
    expect(readSniperPhaseLog()).toEqual({ entries: [], updatedAt: null })
  })

  it('reads a corrupt file as empty and never throws', () => {
    writeFileSync(phasePath(), '{not json')
    expect(readSniperPhaseLog()).toEqual({ entries: [], updatedAt: null })
  })

  it('persists non-UNKNOWN phases newest-first and skips UNKNOWN', () => {
    const decisions = [
      { contract: 'known', ticker: 'KNOWN' },
      { contract: 'single', ticker: 'SINGLE' }, // one reading → UNKNOWN, skipped
    ]
    // two readings with dev 10 → 20: supply entering → DISTRIBUTION.
    const result = persistAccumulationPhases(decisions, auditWith('known', 10, 20))
    const raw = JSON.parse(readFileSync(phasePath(), 'utf8'))

    expect(result.log.entries).toHaveLength(1)
    expect(result.log.entries[0].contract).toBe('known')
    expect(result.log.entries[0].phase).toBe('DISTRIBUTION')
    expect(raw.entries[0].contract).toBe('known')
    expect(readSniperPhaseLog().entries[0].phase).toBe('DISTRIBUTION')
  })

  it('caps persisted entries at MAX_PHASE_ENTRIES, newest first', () => {
    const seed: SniperPhaseEntry[] = Array.from({ length: MAX_PHASE_ENTRIES }, (_, i) => ({
      contract: `seed-${i}`,
      at: new Date(Date.now() - i * 1000).toISOString(),
      phase: 'DISTRIBUTION' as const,
      score: 1,
      readings: 2,
      reason: null,
    }))
    writeFileSync(phasePath(), JSON.stringify({ entries: seed, updatedAt: null }))

    const result = persistAccumulationPhases([{ contract: 'known', ticker: 'KNOWN' }], auditWith('known', 10, 20))

    expect(result.log.entries).toHaveLength(MAX_PHASE_ENTRIES)
    expect(result.log.entries[0].contract).toBe('known')
    expect(readSniperPhaseLog().entries).toHaveLength(MAX_PHASE_ENTRIES)
  })

  it('keeps the newest entry per contract as the dedupe target', () => {
    persistAccumulationPhases([{ contract: 'known', ticker: 'KNOWN' }], auditWith('known', 10, 20))
    const first = persistAccumulationPhases([{ contract: 'known', ticker: 'KNOWN' }], auditWith('known', 10, 20))

    expect(first.log.entries.filter((e) => e.contract === 'known')).toHaveLength(2)
    expect(first.log.entries[0].at >= first.log.entries[1].at).toBe(true)
  })
})

describe('shouldEmitPhase', () => {
  const now = Date.parse('2026-10-14T00:00:00.000Z')
  const entry = (overrides: Partial<SniperPhaseEntry>): SniperPhaseEntry => ({
    contract: 'c',
    at: '2026-10-14T00:00:00.000Z',
    phase: 'ACCUMULATION',
    score: 50,
    readings: 2,
    reason: null,
    ...overrides,
  })

  it('emits on first sighting (null)', () => {
    expect(shouldEmitPhase(null, now, DEFAULT_PHASE_COOLDOWN_MS)).toBe(true)
  })

  it('suppresses a same ACCUMULATION verdict inside the cooldown window', () => {
    expect(shouldEmitPhase(entry({ at: '2026-10-13T23:00:00.000Z' }), now, DEFAULT_PHASE_COOLDOWN_MS)).toBe(false)
  })

  it('emits a different verdict even inside the cooldown window', () => {
    expect(shouldEmitPhase(entry({ phase: 'DISTRIBUTION' }), now, DEFAULT_PHASE_COOLDOWN_MS)).toBe(true)
  })

  it('emits the same verdict after the cooldown window', () => {
    expect(shouldEmitPhase(entry({ at: '2026-10-13T17:59:59.999Z' }), now, DEFAULT_PHASE_COOLDOWN_MS)).toBe(true)
  })

  it('emits when the latest timestamp is unparseable', () => {
    expect(shouldEmitPhase(entry({ at: 'not-a-date' }), now, DEFAULT_PHASE_COOLDOWN_MS)).toBe(true)
  })

  it('honors a custom cooldown window', () => {
    expect(shouldEmitPhase(entry({ at: '2026-10-13T23:59:00.000Z' }), now, 60_000)).toBe(true)
  })
})

describe('classifyAccumulation (real verdict union fixture sanity)', () => {
  it('still returns the ACCUMULATION verdict string the log persists', () => {
    const phase = classifyAccumulation(
      [
        { at: 'a', devPercent: 10, sniperPercent: 5, bundlerPercent: 5, insiderPercent: 5, top10Percent: 50, clusterPercent: 30, marketCapUsd: 100_000, liquidityUsd: 50_000, volume5mUsd: 60_000 },
        { at: 'b', devPercent: 5, sniperPercent: 2, bundlerPercent: 2, insiderPercent: 2, top10Percent: 30, clusterPercent: 15, marketCapUsd: 100_000, liquidityUsd: 50_000, volume5mUsd: 60_000 },
      ],
      ACCUMULATION_DEFAULTS,
    )

    expect(phase.verdict).toBe('ACCUMULATION')
  })
})
