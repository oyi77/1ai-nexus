-- Encrypted integration secret store (see docs/product/03-tech-secrets.md).
-- CREATE IF NOT EXISTS so the migration is safe on live DB (shape lands
-- via db:push first) and fresh DBs.
CREATE TABLE IF NOT EXISTS "IntegrationSecret" (
    "key" TEXT NOT NULL,
    "encValue" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationSecret_pkey" PRIMARY KEY ("key")
);
