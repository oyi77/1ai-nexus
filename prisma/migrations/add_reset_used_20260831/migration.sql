-- AlterTable
-- Add passwordResetUsedAt column to User for single-use password-reset tokens.
ALTER TABLE "User" ADD COLUMN "passwordResetUsedAt" TIMESTAMP(3);
