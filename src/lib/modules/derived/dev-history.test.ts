// ─────────────────────────────────────────────────────────────
// Dev-history classifier unit tests (PURE, no network).
// Boundary coverage for every tier rule documented in dev-history.ts.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  assessDevHistory,
  toSniperGate,
  DEV_HISTORY_DEFAULTS,
  type DevHistoryInput,
  type DevHistoryToken,
} from './dev-history'

// ── Helpers ──

function tokens(n: number, opts: Partial<DevHistoryToken> = {}): DevHistoryToken[] {
  return Array.from({ length: n }, (_, i) => ({
    tokenAddress: `TOKN-${i + 1}`,
    migrated: false,
    migrationPct: 0,
    ...opts,
  }))
}

const input = (tokensIn: DevHistoryToken[]): DevHistoryInput => ({
  devAddress: 'DEV-ADDR',
  tokens: tokensIn,
})

// ── Tests ──

describe('assessDevHistory', () => {
  describe('tier: UNPROVEN', () => {
    it('0 tokens → UNPROVEN with null migrationRate', () => {
      const v = assessDevHistory(input([]))

      expect(v.tier).toBe('UNPROVEN')
      expect(v.previousTokens).toBe(0)
      expect(v.migrations).toBe(0)
      expect(v.migrationRate).toBeNull()
      expect(v.ruggedCount).toBe(0)
      expect(v.reasons.length).toBeGreaterThan(0)
    })

    it('null devAddress with no tokens is still UNPROVEN (never throws)', () => {
      const v = assessDevHistory({ devAddress: null, tokens: [] })

      expect(v.tier).toBe('UNPROVEN')
      expect(v.migrationRate).toBeNull()
    })
  })

  describe('tier: SERIAL_RUGGER (zero migrations)', () => {
    it('exactly 3 tokens, 0 migrated → SERIAL_RUGGER (boundary)', () => {
      const v = assessDevHistory(input(tokens(3)))

      expect(v.tier).toBe('SERIAL_RUGGER')
      expect(v.previousTokens).toBe(3)
      expect(v.migrations).toBe(0)
      expect(v.migrationRate).toBe(0)
      expect(v.reasons[0]).toContain('0 ever migrated')
    })

    it('exactly 2 tokens, 0 migrated → NOT serial-rugger rule (falls through to SUSPECT)', () => {
      const v = assessDevHistory(input(tokens(2)))

      expect(v.tier).toBe('SUSPECT') // rate 0 < 0.34 with 2 deploys
    })

    it('4 tokens, 1 migrated → not the zero-migration rule (rate 0.25 → SUSPECT)', () => {
      const v = assessDevHistory(
        input([{ tokenAddress: 'TOKN-1', migrated: true, migrationPct: 100 }, ...tokens(3)]),
      )

      expect(v.tier).toBe('SUSPECT')
      expect(v.migrations).toBe(1)
    })
  })

  describe('tier: SERIAL_RUGGER (rugged count)', () => {
    it('ruggedCount = 2 → SERIAL_RUGGER (boundary)', () => {
      const v = assessDevHistory(
        input([...tokens(2, { rugged: true, migrated: true, migrationPct: 100 }), ...tokens(1)]),
      )

      expect(v.tier).toBe('SERIAL_RUGGER')
      expect(v.ruggedCount).toBe(2)
      expect(v.reasons[0]).toContain('rugged')
    })

    it('ruggedCount = 1 → NOT SERIAL_RUGGER from ruggedness', () => {
      // 2 deploys, 1 migrated, 1 rugged → rate 0.5 → CLEAN (1 rugged tolerated)
      const v = assessDevHistory(
        input([
          { tokenAddress: 'TOKN-1', migrated: true, migrationPct: 100 },
          { tokenAddress: 'TOKN-2', migrated: false, migrationPct: 0, rugged: true },
        ]),
      )

      expect(v.tier).toBe('CLEAN')
      expect(v.ruggedCount).toBe(1)
    })
  })

  describe('tier: SUSPECT (migration rate)', () => {
    it('rate exactly 0.34 → NOT suspect (strict <), 2+ deploys', () => {
      // 34/100 = 0.34 exactly
      const mixed = Array.from({ length: 100 }, (_, i) => ({
        tokenAddress: `TOKN-${i + 1}`,
        migrated: i < 34,
        migrationPct: i < 34 ? 100 : 0,
      }))
      const v = assessDevHistory(input(mixed))

      expect(v.migrationRate).toBe(0.34)
      expect(v.tier).toBe('CLEAN')
    })

    it('rate just below 0.34 (0.33) with 3 deploys → SUSPECT', () => {
      // 1/3 ≈ 0.3333 < 0.34
      const v = assessDevHistory(
        input([
          { tokenAddress: 'TOKN-1', migrated: true, migrationPct: 100 },
          { tokenAddress: 'TOKN-2', migrated: false, migrationPct: 0 },
          { tokenAddress: 'TOKN-3', migrated: false, migrationPct: 0 },
        ]),
      )

      expect(v.tier).toBe('SUSPECT')
      expect(v.migrationRate).toBeCloseTo(0.3333, 4)
    })

    it('rate below threshold but only 1 deploy → NOT suspect (sample too small)', () => {
      const v = assessDevHistory(input(tokens(1)))

      expect(v.tier).toBe('CLEAN')
      expect(v.migrationRate).toBe(0)
    })
  })

  describe('tier: CLEAN', () => {
    it('all migrated → CLEAN with rate 1', () => {
      const v = assessDevHistory(
        input(tokens(3, { migrated: true, migrationPct: 100 })),
      )

      expect(v.tier).toBe('CLEAN')
      expect(v.migrationRate).toBe(1)
    })

    it('2 deploys, 1 migrated, 0 rugged → CLEAN (rate 0.5 ≥ 0.34)', () => {
      const v = assessDevHistory(
        input([
          { tokenAddress: 'TOKN-1', migrated: true, migrationPct: 100 },
          { tokenAddress: 'TOKN-2', migrated: false, migrationPct: 0 },
        ]),
      )

      expect(v.tier).toBe('CLEAN')
      expect(v.migrationRate).toBe(0.5)
    })
  })

  describe('invariants', () => {
    it('reasons are always non-empty for every tier', () => {
      const verdicts = [
        assessDevHistory(input([])),
        assessDevHistory(input(tokens(3))),
        assessDevHistory(input(tokens(2, { rugged: true }))),
        assessDevHistory(input(tokens(2))),
        assessDevHistory(input(tokens(1, { migrated: true, migrationPct: 100 }))),
      ]

      for (const v of verdicts) {
        expect(v.reasons.length).toBeGreaterThan(0)
        expect(v.reasons[0].length).toBeGreaterThan(0)
      }
    })

    it('thresholds are configurable overrides', () => {
      // Default: 2 tokens 0 migrated → SUSPECT. Tighten serialMinTokens… no,
      // loosen suspectRateMax to 0 → SUSPECT needs rate < 0, impossible.
      const v = assessDevHistory(input(tokens(2)), { suspectRateMax: 0 })

      expect(v.tier).toBe('CLEAN')
    })

    it('defaults match the documented rule set', () => {
      expect(DEV_HISTORY_DEFAULTS).toEqual({
        serialMinTokens: 3,
        ruggedSerialMin: 2,
        suspectRateMax: 0.34,
        suspectMinTokens: 2,
        matureMinAgeSeconds: 3_600,
      })
    })

    it('malformed token entries are tolerated (never throws)', () => {
      const v = assessDevHistory({
        devAddress: null,
        tokens: [
          { tokenAddress: 'A', migrated: false, migrationPct: 0, createdAtAgeSeconds: 7200 },
          { tokenAddress: 'B', migrated: false, migrationPct: 0, createdAtAgeSeconds: 7200 },
        ],
      })

      // 2 mature entries, 0 migrations, rate 0 → SUSPECT per documented rules.
      expect(v.tier).toBe('SUSPECT')
    })
  })
})

describe('toSniperGate', () => {
  it('CLEAN → ok with no rejection', () => {
    const gate = toSniperGate(
      assessDevHistory(input(tokens(1, { migrated: true, migrationPct: 100 }))),
    )

    expect(gate).toEqual({ ok: true })
    expect(gate.rejection).toBeUndefined()
  })

  it('UNPROVEN → ok (cannot punish an unknown dev)', () => {
    const gate = toSniperGate(assessDevHistory(input([])))

    expect(gate).toEqual({ ok: true })
  })

  it('SUSPECT → rejected with dev_history_suspect', () => {
    const gate = toSniperGate(assessDevHistory(input(tokens(2))))

    expect(gate.ok).toBe(false)
    expect(gate.rejection).toBe('dev_history_suspect')
  })

  it('SERIAL_RUGGER (zero migrations) → rejected with dev_serial_scammer', () => {
    const gate = toSniperGate(assessDevHistory(input(tokens(3))))

    expect(gate.ok).toBe(false)
    expect(gate.rejection).toBe('dev_serial_scammer')
  })

  it('SERIAL_RUGGER (rugged count) → rejected with dev_serial_scammer', () => {
    const gate = toSniperGate(
      assessDevHistory(input(tokens(2, { rugged: true }))),
    )

    expect(gate.ok).toBe(false)
    expect(gate.rejection).toBe('dev_serial_scammer')
  })
})
