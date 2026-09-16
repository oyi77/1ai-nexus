-- Stockbit nightly snapshots (harvested via idx-stockbit-harvest.ts).
-- CREATE IF NOT EXISTS so the migration is safe on live DB
-- (which receives the shape via db:push first) and fresh DBs.
CREATE TABLE IF NOT EXISTS "IdxBandarSnapshot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "accdist" TEXT NOT NULL DEFAULT '',
    "avgAmount" DOUBLE PRECISION,
    "avgPct" DOUBLE PRECISION,
    "top1Amount" DOUBLE PRECISION,
    "top3Amount" DOUBLE PRECISION,
    "top5Amount" DOUBLE PRECISION,
    "top10Amount" DOUBLE PRECISION,
    "buyCount" INTEGER NOT NULL DEFAULT 0,
    "sellCount" INTEGER NOT NULL DEFAULT 0,
    "brokers" JSONB,
    "matrix" JSONB,
    CONSTRAINT "IdxBandarSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "IdxStockbitGuru" (
    "id" TEXT NOT NULL,
    "templateId" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL DEFAULT '',
    "snapshotDate" TEXT NOT NULL,
    "matches" JSONB NOT NULL,
    CONSTRAINT "IdxStockbitGuru_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "IdxStockbitAnalyst" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL DEFAULT '',
    "buy" INTEGER NOT NULL DEFAULT 0,
    "sell" INTEGER NOT NULL DEFAULT 0,
    "hold" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "updatedAt" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "IdxStockbitAnalyst_pkey" PRIMARY KEY ("id")
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IdxBandarSnapshot_code_tradeDate_key')
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IdxBandarSnapshot_code_tradeDate_key') THEN
    ALTER TABLE "IdxBandarSnapshot"
      ADD CONSTRAINT "IdxBandarSnapshot_code_tradeDate_key" UNIQUE ("code", "tradeDate");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IdxStockbitGuru_templateId_snapshotDate_key')
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IdxStockbitGuru_templateId_snapshotDate_key') THEN
    ALTER TABLE "IdxStockbitGuru"
      ADD CONSTRAINT "IdxStockbitGuru_templateId_snapshotDate_key" UNIQUE ("templateId", "snapshotDate");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IdxStockbitAnalyst_code_snapshotDate_key')
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IdxStockbitAnalyst_code_snapshotDate_key') THEN
    ALTER TABLE "IdxStockbitAnalyst"
      ADD CONSTRAINT "IdxStockbitAnalyst_code_snapshotDate_key" UNIQUE ("code", "snapshotDate");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IdxBandarSnapshot_tradeDate_idx" ON "IdxBandarSnapshot"("tradeDate" DESC);
CREATE INDEX IF NOT EXISTS "IdxStockbitGuru_snapshotDate_idx" ON "IdxStockbitGuru"("snapshotDate" DESC);
CREATE INDEX IF NOT EXISTS "IdxStockbitAnalyst_snapshotDate_idx" ON "IdxStockbitAnalyst"("snapshotDate" DESC);
