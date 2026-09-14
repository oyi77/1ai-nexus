-- Moonshot lane + tail metrics on AlphaTrackRecord:
-- lane (alpha | moonshot), 60d horizon, MFE from session highs.
-- NOTE: the old schema declared @@unique([code, signalDate]) but the
-- constraint was never created in the DB (db:push era), so there is
-- nothing to drop. Just add the new 3-column unique.
ALTER TABLE "AlphaTrackRecord" ADD COLUMN IF NOT EXISTS "lane" TEXT NOT NULL DEFAULT 'alpha';
ALTER TABLE "AlphaTrackRecord" ADD COLUMN IF NOT EXISTS "price60d" DOUBLE PRECISION;
ALTER TABLE "AlphaTrackRecord" ADD COLUMN IF NOT EXISTS "pnl60dPct" DOUBLE PRECISION;
ALTER TABLE "AlphaTrackRecord" ADD COLUMN IF NOT EXISTS "maxGain30dPct" DOUBLE PRECISION;
ALTER TABLE "AlphaTrackRecord" ADD COLUMN IF NOT EXISTS "maxGain60dPct" DOUBLE PRECISION;
ALTER TABLE "AlphaTrackRecord" ADD COLUMN IF NOT EXISTS "outcome60d" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AlphaTrackRecord_code_signalDate_lane_key'
  ) THEN
    ALTER TABLE "AlphaTrackRecord"
      ADD CONSTRAINT "AlphaTrackRecord_code_signalDate_lane_key" UNIQUE ("code", "signalDate", "lane");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "AlphaTrackRecord_lane_signalDate_idx" ON "AlphaTrackRecord"("lane", "signalDate" DESC);
