#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Whale / smart-money wallet harvester cron.
//
// Harvests wallets from every available source (GMGN leaderboard tags +
// KOLScan verified-KOL roster), merges/dedupes, then:
//   a. Persists to the plain `Wallet` table (chain='solana') — per-wallet
//      failure-isolated, never throws.
//   b. Appends ONLY the new (previously unknown) wallets to the operator's
//      Google Sheet via appendWalletsToSheet (gog auth handled internally).
//
// Idempotent: repeat runs upsert the same rows and only append wallets the
// DB has never seen, so the sheet does not accumulate duplicate rows.
//
// Env:
//   WHALE_HARVEST_SHEET_ENABLED — 'false' to skip the sheet append (default 'true')
//   WHALE_HARVEST_KOLSCAN       — 'false' to skip KOLScan (default 'true')
//   WHALE_HARVEST_WINDOW        — GMGN window: '1d' | '7d' | '30d' (default '30d')
//   KOLSCAN_SESSION             — kolscan.io session cookie (feed empty without it)
//
// Run: npm run harvest:whales
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { prisma } from '@/lib/db'
import { appendWalletsToSheet, type SheetWallet } from '@/lib/modules/derived/smart-money-sync'
import {
  harvestGmgnWallets,
  harvestKolscanWallets,
  mergeHarvest,
  toPersistWallet,
  toSheetRow,
  type WhalePersistWallet,
} from '@/lib/modules/meme/whale-harvester'

/**
 * Upsert harvested wallets into the plain `Wallet` table.
 * Existence is pre-checked with ONE findMany so we can report created vs
 * updated without a per-row read. Per-wallet failure is isolated; this
 * function never throws.
 */
async function persistWallets(
  wallets: WhalePersistWallet[],
): Promise<{ created: number; updated: number; failures: number; newAddresses: Set<string> }> {
  if (wallets.length === 0) return { created: 0, updated: 0, failures: 0, newAddresses: new Set() }

  const addresses = [...new Set(wallets.map((w) => w.address))]
  let existing: Set<string>
  try {
    const rows = await prisma.wallet.findMany({
      where: { address: { in: addresses } },
      select: { address: true },
    })
    existing = new Set(rows.map((r) => r.address))
  } catch (err) {
    console.error(`[whale-harvester] wallet existence pre-check failed: ${err instanceof Error ? err.message : String(err)}`)
    existing = new Set()
  }

  let created = 0
  let updated = 0
  let failures = 0
  const newAddresses = new Set<string>()
  for (const w of wallets) {
    try {
      await prisma.wallet.upsert({
        where: { address: w.address },
        create: {
          address: w.address,
          chain: w.chain,
          alias: w.alias,
          labels: w.labels,
          lastSeen: new Date(),
        },
        update: {
          labels: w.labels,
          lastSeen: new Date(),
          alias: w.alias,
        },
      })
      if (existing.has(w.address)) updated += 1
      else {
        created += 1
        newAddresses.add(w.address)
      }
    } catch (err) {
      failures += 1
      console.error(`[whale-harvester] wallet upsert failed for ${w.address}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { created, updated, failures, newAddresses }
}

async function main() {
  const window = (process.env.WHALE_HARVEST_WINDOW || '30d') as '1d' | '7d' | '30d'
  const kolscanEnabled = (process.env.WHALE_HARVEST_KOLSCAN || 'true') !== 'false'
  const sheetEnabled = (process.env.WHALE_HARVEST_SHEET_ENABLED || 'true') !== 'false'

  console.log(`[whale-harvester] ${new Date().toISOString()} — starting (window=${window} kolscan=${kolscanEnabled} sheet=${sheetEnabled})`)

  // ── 1. Harvest every available source ──
  const [gmgnWallets, kolscanWallets] = await Promise.all([
    harvestGmgnWallets(window),
    kolscanEnabled ? harvestKolscanWallets() : Promise.resolve([]),
  ])

  // ── 2. Merge + dedupe ──
  const merged = mergeHarvest(gmgnWallets, kolscanWallets)

  // ── 3a. Persist to DB (failure-isolated; never throws) ──
  const persisted = merged.map(toPersistWallet)
  const { failures, newAddresses } = await persistWallets(persisted)

  // ── 3b. Append ONLY new wallets to the operator sheet ──
  let sheetCount = 0
  const newWallets = merged.filter((w) => newAddresses.has(w.address))
  const newCount = newWallets.length

  if (sheetEnabled && newCount > 0) {
    const sheetRows: SheetWallet[] = newWallets.map(toSheetRow)
    try {
      sheetCount = await appendWalletsToSheet(sheetRows)
      if (sheetCount === 0) {
        console.warn('[whale-harvester] sheet append returned 0 — continuing (gog creds missing or append rejected)')
      }
    } catch (err) {
      console.error(`[whale-harvester] sheet append failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(
    `[whale-harvester] gmgn=${gmgnWallets.length} kolscan=${kolscanWallets.length} ` +
      `merged=${merged.length} new=${newCount} sheet=${sheetCount} db-failures=${failures}`,
  )

  // created is informational; keep the exit clean unless the DB itself broke.
  process.exit(0)
}

main().catch((err) => {
  console.error('[whale-harvester] FATAL:', err)
  process.exit(1)
})
