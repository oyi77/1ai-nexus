warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('free', 'pro', 'enterprise', 'admin');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('free', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'canceled', 'expired', 'trial');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "logoUrl" TEXT,
    "chains" TEXT[],
    "totalUsdValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "change1d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "entityId" TEXT,
    "labels" TEXT[],
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketCap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volume24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holderCount" INTEGER NOT NULL DEFAULT 0,
    "smartMoneyFlow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenHolding" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "usdValue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TokenHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT,
    "chain" TEXT NOT NULL DEFAULT 'ethereum',
    "txHash" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT,
    "blockNumber" BIGINT,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountRaw" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokenSymbol" TEXT,
    "tokenAddress" TEXT,
    "dex" TEXT,
    "isMEV" BOOLEAN NOT NULL DEFAULT false,
    "approval" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionMarket" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "volume24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "traderCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictionMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionTrade" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictionTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "templateId" TEXT,
    "name" TEXT,
    "condition" TEXT,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFired" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartMoneyWallet" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartMoneyWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeFiProtocol" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tvl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tvlChange24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volume24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,
    "smartMoneyInflow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeFiProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NFTCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "floorPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volume24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueHolders" INTEGER NOT NULL DEFAULT 0,
    "smartMoneyPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "washTradeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NFTCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'free',
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'free',
    "planStartedAt" TIMESTAMP(3),
    "planExpiresAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "apiUsageCount" INTEGER NOT NULL DEFAULT 0,
    "lastApiUsageReset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "lastBlock" BIGINT NOT NULL DEFAULT 0,
    "lastTxHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CexExchange" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "makerFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "takerFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spotVolumeUsd24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "futuresVolumeUsd24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "serverTime" TIMESTAMP(3),
    "lastUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CexExchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CexPair" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "baseSymbol" TEXT NOT NULL,
    "quoteSymbol" TEXT NOT NULL,
    "pairType" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceChange24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volumeUsd24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openInterestUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fundingRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bidAskSpreadBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CexPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CexFundingRate" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "fundingRate" DOUBLE PRECISION NOT NULL,
    "fundingTime" TIMESTAMP(3) NOT NULL,
    "nextFundingTime" TIMESTAMP(3),
    "magnitude" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CexFundingRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CexLiquidation" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "liquidationPrice" DOUBLE PRECISION NOT NULL,
    "estimatedValueUsd" DOUBLE PRECISION NOT NULL,
    "isWhale" BOOLEAN NOT NULL DEFAULT false,
    "whaleTier" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CexLiquidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSignal" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotTrade" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "stake" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "profitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pips" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "strategy" TEXT,
    "source" TEXT,
    "openTime" TIMESTAMP(3) NOT NULL,
    "closeTime" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "assets" TEXT[],
    "sentiment" TEXT,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroDataPoint" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "MacroDataPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "change24h" DOUBLE PRECISION,
    "volume24h" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleHealthRecord" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastChecked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccess" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "ModuleHealthRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityLabel" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrelationSnapshot" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "r" DOUBLE PRECISION NOT NULL,
    "pValue" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrelationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'default',
    "direction" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "resolvedPrice" DOUBLE PRECISION,
    "outcome" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DerivativesSnapshot" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "fundingRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openInterest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "longShortRatio" DOUBLE PRECISION,
    "markPrice" DOUBLE PRECISION,
    "indexPrice" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DerivativesSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidationEvent" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "estimatedValueUsd" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiquidationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentimentSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentimentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnlockEvent" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "unlockDate" TIMESTAMP(3) NOT NULL,
    "amountUsd" DOUBLE PRECISION,
    "percentOfSupply" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnlockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ETFFlowSnapshot" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "netFlowUsd" DOUBLE PRECISION NOT NULL,
    "cumulativeFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ETFFlowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumSnapshot" (
    "id" TEXT NOT NULL,
    "venuePair" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "premiumPct" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MempoolEvent" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "estUsd" DOUBLE PRECISION,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "MempoolEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeFlowEvent" (
    "id" TEXT NOT NULL,
    "sourceChain" TEXT NOT NULL,
    "destChain" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BridgeFlowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakingFlowSnapshot" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "entryQueue" DOUBLE PRECISION,
    "exitQueue" DOUBLE PRECISION,
    "netStaked" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StakingFlowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditRiskSnapshot" (
    "id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "atRiskUsd" DOUBLE PRECISION NOT NULL,
    "avgHealthFactor" DOUBLE PRECISION,
    "positionCount" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditRiskSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinerFlowSnapshot" (
    "id" TEXT NOT NULL,
    "outflowToExchangesUsd" DOUBLE PRECISION NOT NULL,
    "hashRate" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinerFlowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorFlowSnapshot" (
    "id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "netSmartMoneyFlowUsd" DOUBLE PRECISION NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectorFlowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevActivitySnapshot" (
    "id" TEXT NOT NULL,
    "package" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "downloads" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'last-month',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevActivitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "repo" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StablecoinSnapshot" (
    "id" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "marketCap" DOUBLE PRECISION NOT NULL,
    "dominance" DOUBLE PRECISION,
    "change24h" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StablecoinSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleIndicatorSnapshot" (
    "id" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "zone" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleIndicatorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfraSignalSnapshot" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfraSignalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DerivativesIntelSnapshot" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DerivativesIntelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "tp1" DOUBLE PRECISION,
    "tp2" DOUBLE PRECISION,
    "tp3" DOUBLE PRECISION,
    "sl" DOUBLE PRECISION,
    "outcome" TEXT NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "pnlPercent" DOUBLE PRECISION,
    "hitTarget" TEXT,
    "durationHours" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "signalId" TEXT,
    "backtestDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'expired',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Entity_type_idx" ON "Entity"("type");

-- CreateIndex
CREATE INDEX "Entity_totalUsdValue_idx" ON "Entity"("totalUsdValue" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Wallet_chain_idx" ON "Wallet"("chain");

-- CreateIndex
CREATE INDEX "Wallet_entityId_idx" ON "Wallet"("entityId");

-- CreateIndex
CREATE INDEX "Token_smartMoneyFlow_idx" ON "Token"("smartMoneyFlow" DESC);

-- CreateIndex
CREATE INDEX "Token_volume24h_idx" ON "Token"("volume24h" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Token_address_chain_key" ON "Token"("address", "chain");

-- CreateIndex
CREATE INDEX "TokenHolding_usdValue_idx" ON "TokenHolding"("usdValue" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TokenHolding_walletId_tokenId_key" ON "TokenHolding"("walletId", "tokenId");

-- CreateIndex
CREATE INDEX "Transaction_walletId_timestamp_idx" ON "Transaction"("walletId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Transaction_chain_timestamp_idx" ON "Transaction"("chain", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Transaction_amountUsd_idx" ON "Transaction"("amountUsd" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_chain_txHash_key" ON "Transaction"("chain", "txHash");

-- CreateIndex
CREATE INDEX "PredictionMarket_category_status_idx" ON "PredictionMarket"("category", "status");

-- CreateIndex
CREATE INDEX "PredictionMarket_volume24h_idx" ON "PredictionMarket"("volume24h" DESC);

-- CreateIndex
CREATE INDEX "PredictionMarket_totalVolume_idx" ON "PredictionMarket"("totalVolume" DESC);

-- CreateIndex
CREATE INDEX "PredictionTrade_marketId_timestamp_idx" ON "PredictionTrade"("marketId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "PredictionTrade_wallet_idx" ON "PredictionTrade"("wallet");

-- CreateIndex
CREATE INDEX "Alert_userId_isActive_idx" ON "Alert"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SmartMoneyWallet_walletId_key" ON "SmartMoneyWallet"("walletId");

-- CreateIndex
CREATE INDEX "SmartMoneyWallet_score_idx" ON "SmartMoneyWallet"("score" DESC);

-- CreateIndex
CREATE INDEX "SmartMoneyWallet_category_idx" ON "SmartMoneyWallet"("category");

-- CreateIndex
CREATE INDEX "DeFiProtocol_tvl_idx" ON "DeFiProtocol"("tvl" DESC);

-- CreateIndex
CREATE INDEX "DeFiProtocol_chain_category_idx" ON "DeFiProtocol"("chain", "category");

-- CreateIndex
CREATE INDEX "DeFiProtocol_smartMoneyInflow_idx" ON "DeFiProtocol"("smartMoneyInflow" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NFTCollection_address_key" ON "NFTCollection"("address");

-- CreateIndex
CREATE INDEX "NFTCollection_volume24h_idx" ON "NFTCollection"("volume24h" DESC);

-- CreateIndex
CREATE INDEX "NFTCollection_floorPrice_idx" ON "NFTCollection"("floorPrice" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_plan_idx" ON "User"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerCheckpoint_chain_key" ON "IndexerCheckpoint"("chain");

-- CreateIndex
CREATE UNIQUE INDEX "CexExchange_name_key" ON "CexExchange"("name");

-- CreateIndex
CREATE INDEX "CexExchange_status_idx" ON "CexExchange"("status");

-- CreateIndex
CREATE INDEX "CexPair_exchange_idx" ON "CexPair"("exchange");

-- CreateIndex
CREATE INDEX "CexPair_volumeUsd24h_idx" ON "CexPair"("volumeUsd24h" DESC);

-- CreateIndex
CREATE INDEX "CexPair_openInterestUsd_idx" ON "CexPair"("openInterestUsd" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CexPair_exchange_symbol_key" ON "CexPair"("exchange", "symbol");

-- CreateIndex
CREATE INDEX "CexFundingRate_exchange_symbol_timestamp_idx" ON "CexFundingRate"("exchange", "symbol", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "CexFundingRate_fundingTime_idx" ON "CexFundingRate"("fundingTime" DESC);

-- CreateIndex
CREATE INDEX "CexLiquidation_exchange_timestamp_idx" ON "CexLiquidation"("exchange", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "CexLiquidation_estimatedValueUsd_idx" ON "CexLiquidation"("estimatedValueUsd" DESC);

-- CreateIndex
CREATE INDEX "CexLiquidation_isWhale_idx" ON "CexLiquidation"("isWhale");

-- CreateIndex
CREATE INDEX "BotSignal_symbol_timestamp_idx" ON "BotSignal"("symbol", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "BotSignal_confidence_idx" ON "BotSignal"("confidence" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BotTrade_tradeId_key" ON "BotTrade"("tradeId");

-- CreateIndex
CREATE INDEX "BotTrade_symbol_idx" ON "BotTrade"("symbol");

-- CreateIndex
CREATE INDEX "BotTrade_outcome_idx" ON "BotTrade"("outcome");

-- CreateIndex
CREATE INDEX "BotTrade_openTime_idx" ON "BotTrade"("openTime" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_url_key" ON "NewsArticle"("url");

-- CreateIndex
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsArticle_assets_idx" ON "NewsArticle"("assets");

-- CreateIndex
CREATE INDEX "MacroDataPoint_seriesId_idx" ON "MacroDataPoint"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "MacroDataPoint_seriesId_date_key" ON "MacroDataPoint"("seriesId", "date");

-- CreateIndex
CREATE INDEX "MarketSnapshot_symbol_timestamp_idx" ON "MarketSnapshot"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleConfig_userId_moduleId_key" ON "ModuleConfig"("userId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleHealthRecord_moduleId_key" ON "ModuleHealthRecord"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserApiKey_userId_service_key" ON "UserApiKey"("userId", "service");

-- CreateIndex
CREATE UNIQUE INDEX "EntityLabel_address_key" ON "EntityLabel"("address");

-- CreateIndex
CREATE INDEX "EntityLabel_chain_idx" ON "EntityLabel"("chain");

-- CreateIndex
CREATE INDEX "EntityLabel_category_idx" ON "EntityLabel"("category");

-- CreateIndex
CREATE INDEX "CorrelationSnapshot_pair_createdAt_idx" ON "CorrelationSnapshot"("pair", "createdAt");

-- CreateIndex
CREATE INDEX "PaperTrade_userId_status_idx" ON "PaperTrade"("userId", "status");

-- CreateIndex
CREATE INDEX "PaperTrade_marketId_idx" ON "PaperTrade"("marketId");

-- CreateIndex
CREATE INDEX "PaperTrade_createdAt_idx" ON "PaperTrade"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "PaperTrade_status_idx" ON "PaperTrade"("status");

-- CreateIndex
CREATE INDEX "DerivativesSnapshot_exchange_symbol_timestamp_idx" ON "DerivativesSnapshot"("exchange", "symbol", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "DerivativesSnapshot_fundingRate_idx" ON "DerivativesSnapshot"("fundingRate" DESC);

-- CreateIndex
CREATE INDEX "LiquidationEvent_exchange_timestamp_idx" ON "LiquidationEvent"("exchange", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "LiquidationEvent_estimatedValueUsd_idx" ON "LiquidationEvent"("estimatedValueUsd" DESC);

-- CreateIndex
CREATE INDEX "LiquidationEvent_symbol_timestamp_idx" ON "LiquidationEvent"("symbol", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "SentimentSnapshot_source_timestamp_idx" ON "SentimentSnapshot"("source", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "UnlockEvent_unlockDate_idx" ON "UnlockEvent"("unlockDate" DESC);

-- CreateIndex
CREATE INDEX "UnlockEvent_token_idx" ON "UnlockEvent"("token");

-- CreateIndex
CREATE INDEX "ETFFlowSnapshot_asset_date_idx" ON "ETFFlowSnapshot"("asset", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ETFFlowSnapshot_issuer_asset_date_key" ON "ETFFlowSnapshot"("issuer", "asset", "date");

-- CreateIndex
CREATE INDEX "PremiumSnapshot_venuePair_asset_timestamp_idx" ON "PremiumSnapshot"("venuePair", "asset", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "MempoolEvent_chain_detectedAt_idx" ON "MempoolEvent"("chain", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "MempoolEvent_type_detectedAt_idx" ON "MempoolEvent"("type", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "BridgeFlowEvent_sourceChain_destChain_timestamp_idx" ON "BridgeFlowEvent"("sourceChain", "destChain", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "BridgeFlowEvent_amountUsd_idx" ON "BridgeFlowEvent"("amountUsd" DESC);

-- CreateIndex
CREATE INDEX "StakingFlowSnapshot_asset_timestamp_idx" ON "StakingFlowSnapshot"("asset", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "CreditRiskSnapshot_protocol_timestamp_idx" ON "CreditRiskSnapshot"("protocol", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "CreditRiskSnapshot_atRiskUsd_idx" ON "CreditRiskSnapshot"("atRiskUsd" DESC);

-- CreateIndex
CREATE INDEX "MinerFlowSnapshot_timestamp_idx" ON "MinerFlowSnapshot"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "SectorFlowSnapshot_sector_timestamp_idx" ON "SectorFlowSnapshot"("sector", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "SectorFlowSnapshot_netSmartMoneyFlowUsd_idx" ON "SectorFlowSnapshot"("netSmartMoneyFlowUsd" DESC);

-- CreateIndex
CREATE INDEX "DevActivitySnapshot_package_timestamp_idx" ON "DevActivitySnapshot"("package", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "DevActivitySnapshot_ecosystem_timestamp_idx" ON "DevActivitySnapshot"("ecosystem", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "DevActivitySnapshot_timestamp_idx" ON "DevActivitySnapshot"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "AttentionSnapshot_source_metric_timestamp_idx" ON "AttentionSnapshot"("source", "metric", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "StablecoinSnapshot_coin_timestamp_idx" ON "StablecoinSnapshot"("coin", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "CycleIndicatorSnapshot_indicator_timestamp_idx" ON "CycleIndicatorSnapshot"("indicator", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "InfraSignalSnapshot_metric_timestamp_idx" ON "InfraSignalSnapshot"("metric", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "DerivativesIntelSnapshot_metric_asset_timestamp_idx" ON "DerivativesIntelSnapshot"("metric", "asset", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "BacktestResult_symbol_backtestDate_idx" ON "BacktestResult"("symbol", "backtestDate" DESC);

-- CreateIndex
CREATE INDEX "BacktestResult_outcome_idx" ON "BacktestResult"("outcome");

-- CreateIndex
CREATE INDEX "BacktestResult_source_idx" ON "BacktestResult"("source");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_plan_idx" ON "Subscription"("plan");

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_externalId_idx" ON "Payment"("externalId");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenHolding" ADD CONSTRAINT "TokenHolding_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenHolding" ADD CONSTRAINT "TokenHolding_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionTrade" ADD CONSTRAINT "PredictionTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "PredictionMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartMoneyWallet" ADD CONSTRAINT "SmartMoneyWallet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "PredictionMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

