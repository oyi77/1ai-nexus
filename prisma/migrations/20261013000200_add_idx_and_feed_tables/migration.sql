-- ─────────────────────────────────────────────────────────────
-- Add missing IDX + Feed tables (schema drift fix)
--
-- 6 tables declared in prisma/schema.prisma and used across ~25
-- code paths (IDX bandarmology, alpha-track cron, feed health,
-- watchlist ideas, screener, fundamentals, signals) were never
-- created in the database. This caused runtime crashes:
--   The table `public.Feed` does not exist in the current database.
--   The table `public.IdxSahamSession` does not exist in the current database.
--
-- Idempotent: IF NOT EXISTS on all CREATE statements.
-- ─────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE IF NOT EXISTS "IdxSahamSession" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "prev" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "open" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "high" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "low" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "close" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "change" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freq" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "foreignBuy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "foreignSell" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "listedShares" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tradeableShares" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "IdxSahamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IdxBrokerBoard" (
    "id" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freq" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "IdxBrokerBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IdxScreenerSnapshot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sector" TEXT NOT NULL DEFAULT '',
    "subsector" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "subindustry" TEXT NOT NULL DEFAULT '',
    "per" DOUBLE PRECISION,
    "pbv" DOUBLE PRECISION,
    "der" DOUBLE PRECISION,
    "roa" DOUBLE PRECISION,
    "roe" DOUBLE PRECISION,
    "npm" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "change1d" DOUBLE PRECISION,
    "high52w" DOUBLE PRECISION,
    "low52w" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "change4w" DOUBLE PRECISION,
    "change13w" DOUBLE PRECISION,
    "change26w" DOUBLE PRECISION,
    "change52w" DOUBLE PRECISION,
    "ytd" DOUBLE PRECISION,

    CONSTRAINT "IdxScreenerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IdxFundamentals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "per" DOUBLE PRECISION,
    "pbv" DOUBLE PRECISION,
    "roe" DOUBLE PRECISION,
    "der" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "dividendYield" DOUBLE PRECISION,

    CONSTRAINT "IdxFundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Feed" (
    "id" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FeedHealthEvent" (
    "id" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER NOT NULL,
    "items" INTEGER NOT NULL,
    "error" TEXT,
    "ms" INTEGER NOT NULL,

    CONSTRAINT "FeedHealthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IdxSahamSession)
CREATE INDEX IF NOT EXISTS "IdxSahamSession_tradeDate_idx" ON "IdxSahamSession"("tradeDate" DESC);
CREATE INDEX IF NOT EXISTS "IdxSahamSession_code_tradeDate_idx" ON "IdxSahamSession"("code", "tradeDate" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "IdxSahamSession_code_tradeDate_key" ON "IdxSahamSession"("code", "tradeDate");

-- CreateIndex (IdxBrokerBoard)
CREATE INDEX IF NOT EXISTS "IdxBrokerBoard_tradeDate_idx" ON "IdxBrokerBoard"("tradeDate" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "IdxBrokerBoard_tradeDate_firm_key" ON "IdxBrokerBoard"("tradeDate", "firm");

-- CreateIndex (IdxScreenerSnapshot)
CREATE INDEX IF NOT EXISTS "IdxScreenerSnapshot_snapshotDate_idx" ON "IdxScreenerSnapshot"("snapshotDate" DESC);
CREATE INDEX IF NOT EXISTS "IdxScreenerSnapshot_sector_idx" ON "IdxScreenerSnapshot"("sector");
CREATE UNIQUE INDEX IF NOT EXISTS "IdxScreenerSnapshot_code_snapshotDate_key" ON "IdxScreenerSnapshot"("code", "snapshotDate");

-- CreateIndex (IdxFundamentals)
CREATE INDEX IF NOT EXISTS "IdxFundamentals_snapshotDate_idx" ON "IdxFundamentals"("snapshotDate" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "IdxFundamentals_code_snapshotDate_key" ON "IdxFundamentals"("code", "snapshotDate");

-- CreateIndex (Feed)
CREATE UNIQUE INDEX IF NOT EXISTS "Feed_feedId_key" ON "Feed"("feedId");
CREATE INDEX IF NOT EXISTS "Feed_category_idx" ON "Feed"("category");
CREATE INDEX IF NOT EXISTS "Feed_enabled_idx" ON "Feed"("enabled");

-- CreateIndex (FeedHealthEvent)
CREATE INDEX IF NOT EXISTS "FeedHealthEvent_feedId_checkedAt_idx" ON "FeedHealthEvent"("feedId", "checkedAt" DESC);
CREATE INDEX IF NOT EXISTS "FeedHealthEvent_checkedAt_idx" ON "FeedHealthEvent"("checkedAt" DESC);

-- AddForeignKey (deferred — idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'FeedHealthEvent_feedId_fkey'
  ) THEN
    ALTER TABLE "FeedHealthEvent"
      ADD CONSTRAINT "FeedHealthEvent_feedId_fkey"
      FOREIGN KEY ("feedId") REFERENCES "Feed"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
