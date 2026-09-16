ALTER TABLE IF EXISTS "IdxStockbitAnalyst" DROP CONSTRAINT IF EXISTS "IdxStockbitAnalyst_code_snapshotDate_key";
ALTER TABLE IF EXISTS "IdxStockbitGuru" DROP CONSTRAINT IF EXISTS "IdxStockbitGuru_templateId_snapshotDate_key";
ALTER TABLE IF EXISTS "IdxBandarSnapshot" DROP CONSTRAINT IF EXISTS "IdxBandarSnapshot_code_tradeDate_key";
DROP TABLE IF EXISTS "IdxStockbitAnalyst";
DROP TABLE IF EXISTS "IdxStockbitGuru";
DROP TABLE IF EXISTS "IdxBandarSnapshot";
