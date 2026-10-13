-- ─────────────────────────────────────────────────────────────
-- Meme Sniper — State & Audit Tables (migrated from data/*.json)
--
-- Idempotent: tables + indexes created with IF NOT EXISTS so this
-- migration is safe on DBs where the tables were already applied
-- via `prisma db push` or manual `psql`.
-- ─────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE IF NOT EXISTS "SniperScanDecision" (
    "id" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "tier" TEXT,
    "reasons" TEXT[],
    "metrics" JSONB NOT NULL,
    "scores" JSONB,
    "source" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveryTier" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "SniperScanDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SniperAuditEntry" (
    "id" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "marketCapUsd" DOUBLE PRECISION NOT NULL,
    "liquidityUsd" DOUBLE PRECISION NOT NULL,
    "volume1hUsd" DOUBLE PRECISION,
    "volume24hUsd" DOUBLE PRECISION,
    "holderCount" INTEGER,
    "top10HoldersPct" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SniperAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SniperSignalOutcome" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "source" TEXT,
    "stage" TEXT,
    "tier" TEXT,
    "alertPriceUsd" DOUBLE PRECISION NOT NULL,
    "highestPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lowestPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentPriceUsd" DOUBLE PRECISION,
    "currentMcapUsd" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "hitMultiple" DOUBLE PRECISION,
    "roiPct" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SniperSignalOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SniperReviewSeen" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SniperReviewSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (SniperScanDecision)
CREATE INDEX IF NOT EXISTS "SniperScanDecision_contract_chain_idx" ON "SniperScanDecision"("contract", "chain");
CREATE INDEX IF NOT EXISTS "SniperScanDecision_status_scannedAt_idx" ON "SniperScanDecision"("status", "scannedAt" DESC);
CREATE INDEX IF NOT EXISTS "SniperScanDecision_scannedAt_idx" ON "SniperScanDecision"("scannedAt" DESC);
CREATE INDEX IF NOT EXISTS "SniperScanDecision_chain_scannedAt_idx" ON "SniperScanDecision"("chain", "scannedAt" DESC);

-- CreateIndex (SniperAuditEntry)
CREATE INDEX IF NOT EXISTS "SniperAuditEntry_contract_chain_observedAt_idx" ON "SniperAuditEntry"("contract", "chain", "observedAt" DESC);
CREATE INDEX IF NOT EXISTS "SniperAuditEntry_observedAt_idx" ON "SniperAuditEntry"("observedAt" DESC);

-- CreateIndex (SniperSignalOutcome)
CREATE INDEX IF NOT EXISTS "SniperSignalOutcome_contract_chain_idx" ON "SniperSignalOutcome"("contract", "chain");
CREATE INDEX IF NOT EXISTS "SniperSignalOutcome_status_alertedAt_idx" ON "SniperSignalOutcome"("status", "alertedAt" DESC);
CREATE INDEX IF NOT EXISTS "SniperSignalOutcome_alertedAt_idx" ON "SniperSignalOutcome"("alertedAt" DESC);

-- CreateIndex (SniperReviewSeen)
CREATE UNIQUE INDEX IF NOT EXISTS "SniperReviewSeen_key_key" ON "SniperReviewSeen"("key");
CREATE INDEX IF NOT EXISTS "SniperReviewSeen_expiresAt_idx" ON "SniperReviewSeen"("expiresAt");
