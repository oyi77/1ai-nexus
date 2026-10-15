#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// One-time backfill: seed the new DB-primary stores (SessionToken,
// StateMeta) from the legacy JSON files under data/.
//
// Safe to re-run — upserts are idempotent. Run once after
// `prisma db push` adds the tables:
//   npx tsx scripts/backfill-session-db.ts
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const cwd = process.cwd()

const PROVIDER_FILES: Record<string, string> = {
  alphio: 'data/alphio-session.json',
  gmgn: 'data/gmgn-session.json',
  moby: 'data/moby-session.json',
  'moby-fallback': 'data/moby-session-fallback.json',
  stockbit: 'data/stockbit-session.json',
}

const META_FILES: Record<string, string> = {
  'feed-health-prev': 'data/feed-health-prev.json',
  'zero-issue-state': 'data/zero-issue-state.json',
}

async function main() {
  for (const [provider, file] of Object.entries(PROVIDER_FILES)) {
    const path = join(cwd, file)
    if (!existsSync(path)) {
      console.log(`skip ${provider}: file missing`)
      continue
    }
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      const expMs = Number(data.accessTokenExp ?? data.refreshTokenExp ?? 0)
      const expiresAt = expMs > 0 ? new Date(expMs) : null
      await prisma.sessionToken.upsert({
        where: { provider },
        create: { provider, data: data as object, expiresAt },
        update: { data: data as object, expiresAt },
      })
      console.log(`backfilled SessionToken: ${provider}`)
    } catch (e) {
      console.log(`skip ${provider}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  for (const [scope, file] of Object.entries(META_FILES)) {
    const path = join(cwd, file)
    if (!existsSync(path)) {
      console.log(`skip ${scope}: file missing`)
      continue
    }
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      await prisma.stateMeta.upsert({
        where: { scope },
        create: { scope, data: data as object },
        update: { data: data as object },
      })
      console.log(`backfilled StateMeta: ${scope}`)
    } catch (e) {
      console.log(`skip ${scope}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
