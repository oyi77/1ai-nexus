-- Rollback: remove durability fields from UserApiKey.
ALTER TABLE "UserApiKey"
DROP COLUMN "isActive",
DROP COLUMN "tier";
