-- Rollback: drop moonshot lane + tail metrics + 3-col unique.
DROP INDEX IF EXISTS "AlphaTrackRecord_lane_signalDate_idx";
ALTER TABLE "AlphaTrackRecord" DROP CONSTRAINT IF EXISTS "AlphaTrackRecord_code_signalDate_lane_key";
ALTER TABLE "AlphaTrackRecord" DROP COLUMN IF EXISTS "lane";
ALTER TABLE "AlphaTrackRecord" DROP COLUMN IF EXISTS "price60d";
ALTER TABLE "AlphaTrackRecord" DROP COLUMN IF EXISTS "pnl60dPct";
ALTER TABLE "AlphaTrackRecord" DROP COLUMN IF EXISTS "maxGain30dPct";
ALTER TABLE "AlphaTrackRecord" DROP COLUMN IF EXISTS "maxGain60dPct";
ALTER TABLE "AlphaTrackRecord" DROP COLUMN IF EXISTS "outcome60d";
