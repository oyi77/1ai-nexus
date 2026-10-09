-- Additive operator-watch columns on Wallet (Phase 2 wallet foundation).
-- Backward-compatible: every column is nullable or defaulted, so existing
-- rows, queries, and the Prisma client keep working unchanged.
-- Safe on live DB: ADD COLUMN IF NOT EXISTS is a no-op on re-run.
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "alias" TEXT;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "emoji" TEXT;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "alertsOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "sourceFile" TEXT;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "conflictNote" TEXT;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "discoveredAt" TIMESTAMP(3);
