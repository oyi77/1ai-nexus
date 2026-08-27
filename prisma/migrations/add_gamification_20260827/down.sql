-- Rollback for add_gamification_20260827
DROP TABLE "UserEvent";
DROP TABLE "UserBadge";
ALTER TABLE "User" DROP COLUMN "xp";
ALTER TABLE "User" DROP COLUMN "level";
