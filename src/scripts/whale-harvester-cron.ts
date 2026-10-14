#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Whale / smart-money wallet harvester cron.
//
// Harvests wallets from every available source (GMGN multi-window
// leaderboard tags + KOLScan verified-KOL roster), merges/dedupes, then:
//   a. Persists to the plain `Wallet` table (chain='solana') — per-wallet
//      failure-isolated, never throws.
//   b. Appends ONLY the new (previously unknown) wallets to the operator's
//      Google Sheet via appendWalletsToSheet (gog auth handled internally).
//   c. Bridges GMGN-verified wallets into SmartMoneyWallet directly
//      (same logic as the 04:00 bootstrap cron) so newly-classified rows
//      are available immediately without waiting for the next 04:00 run.
//
// Idempotent: repeat runs upsert the same rows and only append wallets the
// DB has never seen, so the sheet does not accumulate duplicate rows.
//
// Env:
//   WHALE_HARVEST_SHEET_ENABLED — 'false' to skip the sheet append (default 'true')
//   WHALE_HARVEST_KOLSCAN       — 'false' to skip KOLScan (default 'true')
//   WHALE_HARVEST_WINDOWS       — comma-separated GMGN windows (default '1d,7d,30d')
//   KOLSCAN_SESSION             — kolscan.io session cookie (feed empty without it)
//
// Run: npm run harvest:whales
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { appendWalletsToSheet, type SheetWallet } from '@/lib/modules/derived/smart-money-sync'
import { gmgnBootstrapInput, gmgnStatusFor } from '@/lib/modules/derived/gmgn-bootstrap'
import {
  harvestGmgnWalletsMultiWindow,
  harvestKolscanWalletsVerified,
  mergeHarvest,
  toPersistWallet,
  toSheetRow,
  type GmgnRankWindow,
  type HarvestedWallet,
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
  const windowsEnv = (process.env.WHALE_HARVEST_WINDOWS || '1d,7d,30d').split(',')
  const windows = windowsEnv
    .map((w) => w.trim())
    .filter((w): w is GmgnRankWindow => w === '1d' || w === '7d' || w === '30d')
  const kolscanEnabled = (process.env.WHALE_HARVEST_KOLSCAN || 'true') !== 'false'
  const sheetEnabled = (process.env.WHALE_HARVEST_SHEET_ENABLED || 'true') !== 'false'

  console.log(
    `[whale-harvester] ${new Date().toISOString()} — starting ` +
      `(windows=${windows.join(',')} kolscan=${kolscanEnabled} sheet=${sheetEnabled})`,
  )

  // ── 1. Harvest every available source ──
  const gmgnWallets = await harvestGmgnWalletsMultiWindow(windows)
  const kolscanResult = kolscanEnabled
    ? await harvestKolscanWalletsVerified(gmgnWallets)
    : { wallets: [], kolscanTotal: 0, kolscanGmgnVerified: 0, kolscanSourceOnly: 0 }

  // ── 2. Merge + dedupe, then keep ONLY GMGN-verified rows ──
  const merged = mergeHarvest(gmgnWallets, kolscanResult.wallets)
  const verified = merged.filter(
    (w) => w.verification === 'WHALE' || w.verification === 'QUALITY',
  )
  const whaleCount = verified.filter((w) => w.verification === 'WHALE').length
  const qualityCount = verified.filter((w) => w.verification === 'QUALITY').length
  const excluded = merged.length - verified.length

  // ── 3a. Persist to DB (failure-isolated; never throws) ──
  const persisted = verified.map(toPersistWallet)
  const { failures, newAddresses } = await persistWallets(persisted)

  // ── 3b. Append ONLY new wallets to the operator sheet ──
  let sheetCount = 0
  const newWallets = verified.filter((w) => newAddresses.has(w.address))
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

  // ── 3c. Bridge GMGN-verified wallets into SmartMoneyWallet directly
  //        (same pure logic as the 04:00 gmgn-bootstrap cron) so newly
  //        classified wallets are available without waiting until 04:00.
  //        Re-runs are idempotent; richer classifications are preserved
  //        by the bootstrap cron's overwrite guard on its next 04:00 run.
  const { classified, bootstrapFailures } = await bootstrapNewlyClassified(gmgnWallets)

  console.log(
    `[whale-harvester] gmgn=${gmgnWallets.length} ` +
      `kolscan=${kolscanResult.kolscanTotal} ` +
      `(gmgn_verified=${kolscanResult.kolscanGmgnVerified} source_only=${kolscanResult.kolscanSourceOnly}) ` +
      `merged=${merged.length} new=${newCount} whale=${whaleCount} quality=${qualityCount} ` +
      `excluded=${excluded} sheet=${sheetCount} ` +
      `classified=${classified} db-failures=${failures + bootstrapFailures}`,
  )

  // Keep the exit clean unless the DB itself broke.
  process.exit(0)
}

/**
 * Bridge GMGN-verified wallets into SmartMoneyWallet using the exact same
 * pure logic as gmgn-bootstrap-cron (gmgnBootstrapInput + gmgnStatusFor).
 * Called inline so the harvester cron's output is immediately usable
 * without waiting for the next 04:00 bootstrap run. Failure-isolated.
 */
async function bootstrapNewlyClassified(
  gmgnWallets: readonly HarvestedWallet[],
): Promise<{ classified: number; bootstrapFailures: number }> {
  const addresses = [...new Set(gmgnWallets.map((w) => w.address))]
  let walletIdByAddress: Map<string, string>
  try {
    const rows = await prisma.wallet.findMany({
      where: { address: { in: addresses } },
      select: { id: true, address: true },
    })
    walletIdByAddress = new Map(rows.map((r) => [r.address.toLowerCase(), r.id]))
  } catch (err) {
    console.error(
      `[whale-harvester] bootstrap wallet lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { classified: 0, bootstrapFailures: 1 }
  }

  let classified = 0
  let bootstrapFailures = 0
  for (const w of gmgnWallets) {
    const walletId = walletIdByAddress.get(w.address.toLowerCase())
    if (!walletId) continue
    const row = gmgnBootstrapInput(w)
    const verdict = gmgnStatusFor(row)
    try {
      await prisma.smartMoneyWallet.upsert({
        where: { walletId },
        create: {
          walletId,
          category: 'gmgn-bootstrap',
          score: 0,
          status: verdict.status,
          pnl30d: row.pnl30d,
          winRate: row.winRate30d,
          sampleCount: 0,
          profitableTokens: 0,
          confidence: verdict.confidence,
          reasons: verdict.reasons as Prisma.InputJsonValue,
          limitations: verdict.limitations as Prisma.InputJsonValue,
          classifiedAt: new Date(),
        },
        update: {
          category: 'gmgn-bootstrap',
          status: verdict.status,
          pnl30d: row.pnl30d,
          winRate: row.winRate30d,
          confidence: verdict.confidence,
          reasons: verdict.reasons as Prisma.InputJsonValue,
          limitations: verdict.limitations as Prisma.InputJsonValue,
          classifiedAt: new Date(),
        },
      })
      classified += 1
    } catch (err) {
      bootstrapFailures += 1
      console.error(
        `[whale-harvester] bootstrap upsert failed for ${w.address}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return { classified, bootstrapFailures }
}

main().catch((err) => {
  console.error('[whale-harvester] FATAL:', err)
  process.exit(1)
})
