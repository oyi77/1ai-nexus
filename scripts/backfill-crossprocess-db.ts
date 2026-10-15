#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// One-time backfill: seed the new cross-process state DB stores from
// the legacy data/*.json artifacts + data/botx-keys.sqlite.
//
// Safe to re-run — upserts are idempotent. Run once after
// `npx prisma db push` adds the tables:
//   npx tsx scripts/backfill-crossprocess-db.ts
//
// Sources:
//   data/wallet-buys-latest.json   → WalletBuySignal
//   data/confluence-latest.json    → ConfluencePrefetch
//   data/call-feed-latest.json     → CallFeed
//   data/botx-keys.sqlite          → BotXKey
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { DatabaseSync } from 'node:sqlite'

const prisma = new PrismaClient()
const cwd = process.cwd()

function readJson<T>(file: string): T | null {
  const p = join(cwd, file)
  if (!existsSync(p)) {
    console.log(`skip ${file}: missing`)
    return null
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch (e) {
    console.log(`skip ${file}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function backfillWalletBuys(): Promise<void> {
  const raw = readJson<{
    generated_at: string
    candidates: Array<{
      contract: string
      chain: string
      buyers: string[]
      buyVolumeUsd: number
      buyCount: number
      firstBuyAt: number
      lastBuyAt: number
    }>
  }>('data/wallet-buys-latest.json')
  if (!raw || !Array.isArray(raw.candidates) || raw.candidates.length === 0) {
    console.log('WalletBuySignal: artifact empty or missing — 0 rows')
    return
  }
  let count = 0
  for (const c of raw.candidates) {
    if (typeof c.contract !== 'string') continue
    try {
      await prisma.walletBuySignal.upsert({
        where: { contract: c.contract },
        create: {
          contract: c.contract,
          chain: c.chain || 'solana',
          buyVolumeUsd: c.buyVolumeUsd ?? 0,
          buyCount: c.buyCount ?? 0,
          firstBuyAt: c.firstBuyAt ? new Date(c.firstBuyAt) : null,
          lastBuyAt: c.lastBuyAt ? new Date(c.lastBuyAt) : null,
          buyers: c.buyers ?? [],
          source: 'backfill',
        },
        update: {},
      })
      count++
    } catch (e) {
      console.log(`  skip ${c.contract}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  console.log(`WalletBuySignal: backfilled ${count} row(s)`)
}

async function backfillConfluence(): Promise<void> {
  const raw = readJson<{
    generated_at: string
    signals: Array<{
      contract: string
      chain: string
      buyers: string[]
      totalBuyUsd: number
      firstBuyAt: number
      lastBuyAt: number
    }>
  }>('data/confluence-latest.json')
  if (!raw || !Array.isArray(raw.signals) || raw.signals.length === 0) {
    console.log('ConfluencePrefetch: artifact empty or missing — 0 rows')
    return
  }
  let count = 0
  for (const s of raw.signals) {
    if (typeof s.contract !== 'string') continue
    try {
      await prisma.confluencePrefetch.upsert({
        where: { contract: s.contract },
        create: {
          contract: s.contract,
          chain: s.chain || 'solana',
          signals: {
            buyers: s.buyers,
            totalBuyUsd: s.totalBuyUsd,
            firstBuyAt: s.firstBuyAt,
            lastBuyAt: s.lastBuyAt,
          },
        },
        update: {},
      })
      count++
    } catch (e) {
      console.log(`  skip ${s.contract}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  console.log(`ConfluencePrefetch: backfilled ${count} row(s)`)
}

async function backfillCallFeed(): Promise<void> {
  const raw = readJson<{
    generated_at: string
    candidates: Array<Record<string, unknown>>
  }>('data/call-feed-latest.json')
  if (!raw || !Array.isArray(raw.candidates) || raw.candidates.length === 0) {
    console.log('CallFeed: artifact empty or missing — 0 rows')
    return
  }
  let count = 0
  for (const c of raw.candidates) {
    const contract = c.contract
    if (typeof contract !== 'string') continue
    const lastSeen = typeof c.last_seen === 'string' ? c.last_seen : raw.generated_at
    const lastSeenAt = Number.isFinite(Date.parse(lastSeen)) ? new Date(lastSeen) : new Date()
    try {
      await prisma.callFeed.upsert({
        where: { contract },
        create: {
          contract,
          chain: (c.chain as string) || 'solana',
          ticker: '',
          marketCapUsd: null,
          mentionCount: typeof c.mentions === 'number' ? c.mentions : 0,
          lastSeenAt,
        },
        update: {},
      })
      count++
    } catch (e) {
      console.log(`  skip ${contract}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  console.log(`CallFeed: backfilled ${count} row(s)`)
}

async function backfillBotxKeys(): Promise<void> {
  const p = join(cwd, 'data', 'botx-keys.sqlite')
  if (!existsSync(p)) {
    console.log('BotXKey: sqlite missing — 0 rows')
    return
  }
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(p, { readOnly: true })
    const stmt = db.prepare(
      `SELECT id, api_key as apiKey, email, created_at as createdAt,
              last_used as lastUsed, last_checked as lastChecked,
              is_healthy as isHealthy, rate_limited as rateLimited,
              error_count as errorCount, request_count as requestCount
       FROM botx_keys ORDER BY created_at ASC`,
    )
    const rows = stmt.all() as Array<Record<string, unknown>>
    if (rows.length === 0) {
      console.log('BotXKey: sqlite empty — 0 rows')
      return
    }
    let count = 0
    for (const r of rows) {
      const apiKey = r.apiKey as string
      if (!apiKey) continue
      try {
        await prisma.botXKey.upsert({
          where: { apiKey },
          create: {
            apiKey,
            email: (r.email as string) ?? '',
            createdAt: new Date(r.createdAt as number),
            lastUsed: new Date(r.lastUsed as number),
            lastChecked: new Date(r.lastChecked as number),
            isHealthy: Boolean(r.isHealthy),
            rateLimited: Boolean(r.rateLimited),
            errorCount: (r.errorCount as number) ?? 0,
            requestCount: (r.requestCount as number) ?? 0,
          },
          update: {},
        })
        count++
      } catch (e) {
        console.log(`  skip key: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    console.log(`BotXKey: backfilled ${count} row(s)`)
  } catch (e) {
    console.log(`BotXKey: sqlite read failed — ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    db?.close()
  }
}

async function main(): Promise<void> {
  console.log('=== backfill cross-process state DBs ===')
  await backfillWalletBuys()
  await backfillConfluence()
  await backfillCallFeed()
  await backfillBotxKeys()
  console.log('=== done ===')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
