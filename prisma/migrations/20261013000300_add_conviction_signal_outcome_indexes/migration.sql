-- ─────────────────────────────────────────────────────────────
-- ConvictionSignal: declare the outcome-filter indexes
--
-- src/lib/conviction/track-record.ts filters on `outcome`:
--   line  72: where: { price: { not: null }, outcome: null, emittedAt: { lt: cutoff } }
--   line 131: where: { outcome: { in: ['win', 'loss'] } }
--
-- These two indexes exist in the live database (and are used — 6 and 1
-- idx_scan respectively) but were never declared in prisma/schema.prisma,
-- so a fresh deploy built from schema would lack them and fall back to
-- sequential scans. Schema now declares them; this migration brings any
-- other environment to parity.
--
-- Idempotent: IF NOT EXISTS on both.
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "ConvictionSignal_emittedAt_outcome_idx"
  ON "ConvictionSignal"("emittedAt", "outcome");

CREATE INDEX IF NOT EXISTS "ConvictionSignal_market_outcome_conviction_idx"
  ON "ConvictionSignal"("market", "outcome", "conviction");
