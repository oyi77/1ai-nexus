-- Additive wallet-intelligence columns on SmartMoneyWallet (Fase 3).
-- Backward-compatible: every new column is nullable or defaulted; the legacy
-- category/score heuristic is untouched and keeps feeding SFC/cohort.
-- Safe on live DB: ADD COLUMN IF NOT EXISTS is a no-op on re-run.
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "pnl30d" DOUBLE PRECISION;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "winRate" DOUBLE PRECISION;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "sampleCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "profitableTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "confidence" TEXT;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "reasons" JSONB;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "limitations" JSONB;
ALTER TABLE "SmartMoneyWallet" ADD COLUMN IF NOT EXISTS "classifiedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SmartMoneyWallet_status_idx" ON "SmartMoneyWallet"("status");
CREATE INDEX IF NOT EXISTS "SmartMoneyWallet_pnl30d_idx" ON "SmartMoneyWallet"("pnl30d" DESC);
CREATE INDEX IF NOT EXISTS "SmartMoneyWallet_classifiedAt_idx" ON "SmartMoneyWallet"("classifiedAt" DESC);
