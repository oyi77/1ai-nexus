-- Rollback: remove passwordResetUsedAt from User.
ALTER TABLE "User" DROP COLUMN "passwordResetUsedAt";
