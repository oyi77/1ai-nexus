-- CreateTable
CREATE TABLE "ConvictionSignal" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "conviction" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "reasons" JSONB,
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "priceAfter" DOUBLE PRECISION,
    "pnlPercent" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),
    CONSTRAINT "ConvictionSignal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConvictionSignal_market_conviction_idx" ON "ConvictionSignal"("market", "conviction");
CREATE INDEX "ConvictionSignal_emittedAt_idx" ON "ConvictionSignal"("emittedAt");
CREATE INDEX "ConvictionSignal_symbol_emittedAt_idx" ON "ConvictionSignal"("symbol", "emittedAt" DESC);
