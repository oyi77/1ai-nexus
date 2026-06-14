// ─────────────────────────────────────────────────────────────
// Shared Prisma Client Singleton for the indexer sidecar
// Prevents multiple connection pools across modules
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __indexerPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__indexerPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__indexerPrisma = prisma;
}
