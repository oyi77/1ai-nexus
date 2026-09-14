-- Baseline for AlphaTrackRecord (table was born via db:push, never in migration
-- chain — fresh `migrate deploy` failed with "relation does not exist").
-- CREATE IF NOT EXISTS with the FINAL shape (lane + 60d + MFE tails +
-- 3-column unique): no-op on live DB, creates everything on fresh DB.
-- The follow-up add_moonshot_lane_20260914 migration is then a safe no-op
-- everywhere (all its statements are IF NOT EXISTS).
--
-- Live DB (db:push era) carries the 3-col unique name as a UNIQUE INDEX,
-- not a constraint — the DO blocks guard both catalogs or ADD CONSTRAINT
-- collides (E42P07, found 2026-09-15).
CREATE TABLE IF NOT EXISTS "AlphaTrackRecord" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sector" TEXT NOT NULL DEFAULT '',
    "signalDate" TEXT NOT NULL,
    "lane" TEXT NOT NULL DEFAULT 'alpha',
    "alphaScore" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "priceAtSignal" DOUBLE PRECISION NOT NULL,
    "price7d" DOUBLE PRECISION,
    "price14d" DOUBLE PRECISION,
    "price30d" DOUBLE PRECISION,
    "price60d" DOUBLE PRECISION,
    "pnl7dPct" DOUBLE PRECISION,
    "pnl14dPct" DOUBLE PRECISION,
    "pnl30dPct" DOUBLE PRECISION,
    "pnl60dPct" DOUBLE PRECISION,
    "maxGain30dPct" DOUBLE PRECISION,
    "maxGain60dPct" DOUBLE PRECISION,
    "outcome7d" TEXT,
    "outcome14d" TEXT,
    "outcome30d" TEXT,
    "outcome60d" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "signals" JSONB,
    CONSTRAINT "AlphaTrackRecord_pkey" PRIMARY KEY ("id")
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AlphaTrackRecord_code_signalDate_lane_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'AlphaTrackRecord_code_signalDate_lane_key'
  ) THEN
    ALTER TABLE "AlphaTrackRecord"
      ADD CONSTRAINT "AlphaTrackRecord_code_signalDate_lane_key" UNIQUE ("code", "signalDate", "lane");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "AlphaTrackRecord_signalDate_idx" ON "AlphaTrackRecord"("signalDate" DESC);
CREATE INDEX IF NOT EXISTS "AlphaTrackRecord_verdict_alphaScore_idx" ON "AlphaTrackRecord"("verdict", "alphaScore" DESC);
CREATE INDEX IF NOT EXISTS "AlphaTrackRecord_lane_signalDate_idx" ON "AlphaTrackRecord"("lane", "signalDate" DESC);
