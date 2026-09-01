-- Remove referral program fields
DROP INDEX IF EXISTS "User_referredById_idx";
DROP INDEX IF EXISTS "User_referralCode_idx";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_referredById_fkey";
ALTER TABLE "User" DROP COLUMN IF EXISTS "referralCredits";
ALTER TABLE "User" DROP COLUMN IF EXISTS "referralsCount";
ALTER TABLE "User" DROP COLUMN IF EXISTS "referredById";
ALTER TABLE "User" DROP COLUMN IF EXISTS "referralCode";
