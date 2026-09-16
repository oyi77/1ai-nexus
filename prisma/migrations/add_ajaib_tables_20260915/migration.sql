-- Ajaib nightly snapshots (harvested via idx-ajaib-harvest.ts).
-- CREATE IF NOT EXISTS so the migration is safe on live DB
-- (which received the shape via db:push first) and fresh DBs.
CREATE TABLE IF NOT EXISTS "IdxAjaibUniverse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "price" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "weekPrice" DOUBLE PRECISION,
    "weekPct" DOUBLE PRECISION,
    "weekChg" DOUBLE PRECISION,
    "monthPrice" DOUBLE PRECISION,
    "monthPct" DOUBLE PRECISION,
    "monthChg" DOUBLE PRECISION,
    CONSTRAINT "IdxAjaibUniverse_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "IdxAjaibConsensus" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL DEFAULT '',
    "buy" INTEGER NOT NULL DEFAULT 0,
    "sell" INTEGER NOT NULL DEFAULT 0,
    "hold" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "targetPrice" DOUBLE PRECISION,
    "currentPrice" DOUBLE PRECISION,
    "highPrice" DOUBLE PRECISION,
    "lowPrice" DOUBLE PRECISION,
    "consensus" JSONB,
    "technicals" JSONB,
    "bands" JSONB,
    CONSTRAINT "IdxAjaibConsensus_pkey" PRIMARY KEY ("id")
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IdxAjaibUniverse_code_snapshotDate_key')
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IdxAjaibUniverse_code_snapshotDate_key') THEN
    ALTER TABLE "IdxAjaibUniverse"
      ADD CONSTRAINT "IdxAjaibUniverse_code_snapshotDate_key" UNIQUE ("code", "snapshotDate");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IdxAjaibConsensus_code_snapshotDate_key')
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IdxAjaibConsensus_code_snapshotDate_key') THEN
    ALTER TABLE "IdxAjaibConsensus"
      ADD CONSTRAINT "IdxAjaibConsensus_code_snapshotDate_key" UNIQUE ("code", "snapshotDate");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IdxAjaibUniverse_snapshotDate_idx" ON "IdxAjaibUniverse"("snapshotDate" DESC);
CREATE INDEX IF NOT EXISTS "IdxAjaibConsensus_snapshotDate_idx" ON "IdxAjaibConsensus"("snapshotDate" DESC);
