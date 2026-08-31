-- AlterTable
-- Add durability fields to UserApiKey: isActive (for revocation) and tier (for rate limits).
ALTER TABLE "UserApiKey"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free';
