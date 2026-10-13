-- ─────────────────────────────────────────────────────────────
-- Add User.alphaAlertsEnabled — per-user Telegram alpha alert opt-in.
--
-- Drift fix: prisma/schema.prisma declared this column and
-- src/lib/telegram/alpha-alerts.ts:74 filters on it, but the column
-- was never created in the database. The alpha-track cron query
-- failed at runtime with:
--   The column `User.alphaAlertsEnabled` does not exist in the current database.
--
-- Idempotent: safe on DBs where the column already exists.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "alphaAlertsEnabled" BOOLEAN NOT NULL DEFAULT true;
