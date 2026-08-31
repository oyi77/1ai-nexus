-- Rollback: remove emailVerified from User.
ALTER TABLE "User" DROP COLUMN "emailVerified";
