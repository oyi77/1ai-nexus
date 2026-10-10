-- Rollback for add_smart_money_classification_20261010.
-- Drops only the classification columns/indexes; legacy category/score remain.
DROP INDEX IF EXISTS "SmartMoneyWallet_classifiedAt_idx";
DROP INDEX IF EXISTS "SmartMoneyWallet_pnl30d_idx";
DROP INDEX IF EXISTS "SmartMoneyWallet_status_idx";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "classifiedAt";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "limitations";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "reasons";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "confidence";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "profitableTokens";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "sampleCount";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "winRate";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "pnl30d";
ALTER TABLE "SmartMoneyWallet" DROP COLUMN IF EXISTS "status";
