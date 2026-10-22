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

  describe('tier: zero migrations is a base rate, not a signal', () => {
    it('exactly 3 tokens, 0 migrated → UNPROVEN (0/3 is the normal outcome)', () => {
      // P(0 of 3 | honest dev, p=1/70) = 95.8% — a streak that ordinary.
      const v = assessDevHistory(input(tokens(3)))

      expect(v.tier).toBe('UNPROVEN')
      expect(v.previousTokens).toBe(3)
      expect(v.migrations).toBe(0)
      expect(v.migrationRate).toBe(0)
      expect(v.reasons[0]).toContain('not evidence of fraud')
    })

    it('20 tokens, 0 migrated → UNPROVEN (75% of honest devs do the same)', () => {
      const v = assessDevHistory(input(tokens(20)))

      expect(v.knownMigrations).toBe(20)
      expect(v.tier).toBe('UNPROVEN')
      expect(v.reasons[0]).toContain('75')
    })

    it('a zero streak well past the binomial bar → SERIAL_RUGGER', () => {
      // P(0 of 400 | p=1/70) = (69/70)^400 ≈ 0.3% < the 5% limit.
      const v = assessDevHistory(input(tokens(400)))

      expect(v.tier).toBe('SERIAL_RUGGER')
      expect(v.reasons[0]).toContain('0 of 400 judged tokens migrated')
    })

    it('2 tokens, 0 migrated → CLEAN (one deploy is not a sample)', () => {
      const v = assessDevHistory(input(tokens(2)))

      expect(v.tier).toBe('CLEAN')
    })

    it('3 prior tokens, 1 of the priors migrated → CLEAN, not a zero streak', () => {
      const v = assessDevHistory(
        input([{ tokenAddress: 'TOKN-1', migrated: true, migrationPct: 100 }, ...tokens(3)]),
      )

      expect(v.tier).toBe('CLEAN')
      expect(v.migrations).toBe(1)
    })
  })

  describe('tier: immature history (time is not evidence)', () => {
    it('3 tokens all 24 minutes old → UNPROVEN, NOT SERIAL_RUGGER', () => {
      // Live case 2026-10-22 (token EVOLVE): dev with 3 tokens, youngest 1448s
      // old, none migrated. Aged history had zero chance to migrate, so the
      // zero-migration rule cannot fire.
      const v = assessDevHistory(input(tokens(3, { createdAtAgeSeconds: 1_448 })))

      expect(v.tier).toBe('UNPROVEN')
      expect(v.previousTokens).toBe(3)
      expect(v.matureTokens).toBe(0)
      expect(v.migrationRate).toBeNull()
      expect(v.reasons[0]).toContain('not yet measurable')
    })

    it('one mature zero-migration token plus two young → still not SERIAL_RUGGER', () => {
      const v = assessDevHistory(
        input([
          { tokenAddress: 'OLD', migrated: false, migrationPct: 0, createdAtAgeSeconds: 86_400 },
          ...tokens(2, { createdAtAgeSeconds: 60 }),
        ]),
      )

      expect(v.matureTokens).toBe(1)
      expect(v.tier).not.toBe('SERIAL_RUGGER')
    })

    it('a migrated token counts regardless of age', () => {
      const v = assessDevHistory(
        input([
          { tokenAddress: 'FRESH-MIGRATED', migrated: true, migrationPct: 100, createdAtAgeSeconds: 30 },
          ...tokens(2, { createdAtAgeSeconds: 30 }),
        ]),
      )

      expect(v.matureTokens).toBe(1)
      expect(v.migrations).toBe(1)
      expect(v.tier).not.toBe('SERIAL_RUGGER')
    })

    it('age equal to the maturity threshold counts as mature (boundary)', () => {
      const v = assessDevHistory(
        input(tokens(3, { createdAtAgeSeconds: DEV_HISTORY_DEFAULTS.matureMinAgeSeconds })),
      )

      expect(v.matureTokens).toBe(3)
      expect(v.knownMigrations).toBe(3)
      expect(v.tier).toBe('UNPROVEN')
    })
  })

  describe('unreported migration outcome', () => {
    it('migrated: null is excluded from the judged sample, never read as a failure', () => {
      const v = assessDevHistory(
        input(tokens(3, { migrated: null, createdAtAgeSeconds: 86_400 })),
      )

      expect(v.previousTokens).toBe(3)
      expect(v.knownMigrations).toBe(0)
      expect(v.migrations).toBe(0)
      expect(v.migrationRate).toBeNull()
      expect(v.tier).not.toBe('SERIAL_RUGGER')
    })

    it('2 known outcomes plus 3 unreported → the judged sample is 2, below the floor', () => {
      const v = assessDevHistory(
        input([
          ...tokens(2, { migrated: false, createdAtAgeSeconds: 86_400 }),
          ...tokens(3, { migrated: null, createdAtAgeSeconds: 86_400 }),
        ]),
      )

      expect(v.knownMigrations).toBe(2)
      expect(v.tier).toBe('CLEAN')
    })

    it('3 known zero-migration outcomes → UNPROVEN, not a rugger verdict', () => {
      const v = assessDevHistory(
        input(tokens(3, { migrated: false, createdAtAgeSeconds: 86_400 })),
      )

      expect(v.knownMigrations).toBe(3)
      expect(v.tier).toBe('UNPROVEN')
      expect(v.reasons[0]).toContain('UNPROVEN ≠ CLEAN')
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

    it('ruggedCount = 1 → SUSPECT (risk flag, not a conviction)', () => {
      const v = assessDevHistory(
        input([
          { tokenAddress: 'TOKN-1', migrated: true, migrationPct: 100 },
          { tokenAddress: 'TOKN-2', migrated: false, migrationPct: 0, rugged: true },
        ]),
      )

      expect(v.tier).toBe('SUSPECT')
      expect(v.ruggedCount).toBe(1)
      expect(v.reasons[0]).toContain('risk flag, not a conviction')
    })
  })

  describe('tier: SUSPECT (thin migration record)', () => {
    it('0 of 209 prior deploys migrated → SERIAL_RUGGER on the binomial bar', () => {
      // (69/70)^209 ≈ 4.9% — the first sample size that clears the 5% limit.
      const v = assessDevHistory(input(tokens(209)))

      expect(v.tier).toBe('SERIAL_RUGGER')
      expect(v.reasons[0]).toContain('0 of 209 judged tokens migrated')
    })

    it('1 of 3 judged → CLEAN: a single migration already beats the baseline', () => {
      const v = assessDevHistory(
        input([
          { tokenAddress: 'TOKN-1', migrated: true, migrationPct: 100 },
          { tokenAddress: 'TOKN-2', migrated: false, migrationPct: 0 },
          { tokenAddress: 'TOKN-3', migrated: false, migrationPct: 0 },
        ]),
      )

      expect(v.tier).toBe('CLEAN')
      expect(v.migrationRate).toBeCloseTo(0.3333, 4)
    })

    it('only 1 deploy → CLEAN (no sample to judge)', () => {
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

    it('2 deploys, 1 migrated, 0 rugged → CLEAN (rate 0.5)', () => {
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
      const v = assessDevHistory(input(tokens(100)), { serialMaxBaselineP: 0.5 })

      expect(v.tier).toBe('SERIAL_RUGGER')
    })

    it('defaults match the documented rule set', () => {
      expect(DEV_HISTORY_DEFAULTS).toEqual({
        serialMinTokens: 3,
        serialMaxBaselineP: 0.05,
        baselineMigrationRate: 1 / 70,
        ruggedSerialMin: 2,
        ruggedSuspectMin: 1,
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

      // 2 mature entries, 0 migrations, rate 0 → CLEAN: below the judged floor.
      expect(v.tier).toBe('CLEAN')
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
    const gate = toSniperGate(
      assessDevHistory(input([...tokens(1, { migrated: true, migrationPct: 100 }), ...tokens(1, { rugged: true })])),
    )

    expect(gate.ok).toBe(false)
    expect(gate.rejection).toBe('dev_history_suspect')
  })

  it('a normal zero-migration dev passes (0/3 is not evidence of fraud)', () => {
    const gate = toSniperGate(assessDevHistory(input(tokens(3))))

    expect(gate).toEqual({ ok: true })
  })

  it('SERIAL_RUGGER (improbable zero streak) → rejected with dev_serial_scammer', () => {
    const gate = toSniperGate(assessDevHistory(input(tokens(400))))

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
