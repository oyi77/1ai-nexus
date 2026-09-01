-- Add referral program fields to User table
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT UNIQUE;
ALTER TABLE "User" ADD COLUMN "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN "referralsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "referralCredits" INTEGER NOT NULL DEFAULT 0;

-- Indexes
CREATE INDEX "User_referralCode_idx" ON "User"("referralCode");
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- Foreign key (self-referential)
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
