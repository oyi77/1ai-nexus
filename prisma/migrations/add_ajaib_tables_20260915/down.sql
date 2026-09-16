ALTER TABLE IF EXISTS "IdxAjaibConsensus" DROP CONSTRAINT IF EXISTS "IdxAjaibConsensus_code_snapshotDate_key";
ALTER TABLE IF EXISTS "IdxAjaibUniverse" DROP CONSTRAINT IF EXISTS "IdxAjaibUniverse_code_snapshotDate_key";
DROP TABLE IF EXISTS "IdxAjaibConsensus";
DROP TABLE IF EXISTS "IdxAjaibUniverse";
