-- CreateTable
CREATE TABLE "WalletRelationship" (
    "id" TEXT NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "totalUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchToken" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "creatorAddress" TEXT,
    "liquidityUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketCapUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volume24hUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ageMinutes" INTEGER NOT NULL DEFAULT 0,
    "bondingProgress" DOUBLE PRECISION,
    "migrationState" TEXT,
    "hypeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "launchAlphaScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchFlowSnapshot" (
    "id" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "m5Buys" INTEGER NOT NULL DEFAULT 0,
    "m5Sells" INTEGER NOT NULL DEFAULT 0,
    "h1Buys" INTEGER NOT NULL DEFAULT 0,
    "h1Sells" INTEGER NOT NULL DEFAULT 0,
    "h24Buys" INTEGER NOT NULL DEFAULT 0,
    "h24Sells" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchFlowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadLagMatrix" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "dexVenue" TEXT NOT NULL,
    "cexVenue" TEXT NOT NULL,
    "bestLagMinutes" INTEGER NOT NULL DEFAULT 0,
    "correlation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadLagMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySnapshot" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "priceAtCreate" DOUBLE PRECISION,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "realizedPct" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LrfgEvent" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "oiDeltaPct" DOUBLE PRECISION NOT NULL,
    "priceDeltaPct" DOUBLE PRECISION NOT NULL,
    "fundingRate" DOUBLE PRECISION NOT NULL,
    "longShortRatio" DOUBLE PRECISION,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reboundedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "LrfgEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletRelationship_fromWalletId_relationshipType_idx" ON "WalletRelationship"("fromWalletId", "relationshipType");

-- CreateIndex
CREATE INDEX "WalletRelationship_toWalletId_relationshipType_idx" ON "WalletRelationship"("toWalletId", "relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "WalletRelationship_fromWalletId_toWalletId_relationshipType_key" ON "WalletRelationship"("fromWalletId", "toWalletId", "relationshipType");

-- CreateIndex
CREATE INDEX "LaunchToken_chain_firstSeen_idx" ON "LaunchToken"("chain", "firstSeen" DESC);

-- CreateIndex
CREATE INDEX "LaunchToken_launchAlphaScore_idx" ON "LaunchToken"("launchAlphaScore" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LaunchToken_address_chain_key" ON "LaunchToken"("address", "chain");

-- CreateIndex
CREATE INDEX "LaunchFlowSnapshot_tokenAddress_chain_timestamp_idx" ON "LaunchFlowSnapshot"("tokenAddress", "chain", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "LeadLagMatrix_asset_computedAt_idx" ON "LeadLagMatrix"("asset", "computedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LeadLagMatrix_asset_dexVenue_cexVenue_key" ON "LeadLagMatrix"("asset", "dexVenue", "cexVenue");

-- CreateIndex
CREATE INDEX "OpportunitySnapshot_source_score_idx" ON "OpportunitySnapshot"("source", "score" DESC);

-- CreateIndex
CREATE INDEX "OpportunitySnapshot_resolved_createdAt_idx" ON "OpportunitySnapshot"("resolved", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LrfgEvent_symbol_detectedAt_idx" ON "LrfgEvent"("symbol", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "LrfgEvent_exchange_detectedAt_idx" ON "LrfgEvent"("exchange", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "LrfgEvent_detectedAt_idx" ON "LrfgEvent"("detectedAt" DESC);

-- AddForeignKey
ALTER TABLE "WalletRelationship" ADD CONSTRAINT "WalletRelationship_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletRelationship" ADD CONSTRAINT "WalletRelationship_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchFlowSnapshot" ADD CONSTRAINT "LaunchFlowSnapshot_tokenAddress_chain_fkey" FOREIGN KEY ("tokenAddress", "chain") REFERENCES "LaunchToken"("address", "chain") ON DELETE CASCADE ON UPDATE CASCADE;

