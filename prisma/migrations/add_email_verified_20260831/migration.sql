-- AlterTable
-- Add emailVerified column to User for email verification flow.
ALTER TABLE "User" ADD COLUMN "emailVerified" TIMESTAMP(3);
