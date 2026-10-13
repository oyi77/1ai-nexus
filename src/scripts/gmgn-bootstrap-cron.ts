// ─────────────────────────────────────────────────────────────
// GMGN bootstrap cron — bridge classification for harvested whales.
//
// Uses the whale-harvester's GMGN sweep (~18 tags, 800ms delay) so we
// never re-sweep the leaderboard ourselves. For every harvested wallet:
//   a. Resolve the plain `Wallet` row (ONE findMany upfront).
//   b. Map GMGN winrate/pnl to a bootstrap status (gmgnStatusFor).
//   c. Upsert SmartMoneyWallet DIRECTLY — never via the full classifier.
//
// Overwrite guard: a full wallet-intel classification is richer than this
// bridge. When the existing SmartMoneyWallet already carries real episode
// counts (sampleCount > 0) or a 'full-classifier' marker in reasons, we
// SKIP the update so the richer label is never downgraded.
//
// Idempotent: re-runs upsert the same rows, never duplicates.
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { harvestGmgnWallets } from '@/lib/modules/meme/whale-harvester'
import {
  gmgnBootstrapInput,
  gmgnStatusFor,
} from '@/lib/modules/derived/gmgn-bootstrap'

const FULL_CLASSIFIER_MARKER = 'full-classifier'

/** Deep-search a Prisma Json value for `needle` (strings/arrays/objects). */
function jsonContainsString(
  value: Prisma.JsonValue | null | undefined,
  needle: string,
): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some((v) => jsonContainsString(v, needle))
  if (typeof value === 'object') {
    return Object.values(value).some((v) =>
      jsonContainsString(v as Prisma.JsonValue, needle),
    )
  }
  return false
}

interface ExistingSmwGuard {
  sampleCount: number
  reasons: Prisma.JsonValue | null
}

/** True when the existing row carries a richer full-classifier verdict. */
function isRicherClassification(existing: ExistingSmwGuard | undefined): boolean {
  if (!existing) return false
  if (existing.sampleCount > 0) return true
  return jsonContainsString(existing.reasons, FULL_CLASSIFIER_MARKER)
}

async function main(): Promise<void> {
  console.log(`[gmgn-bootstrap] ${new Date().toISOString()} — starting harvest (window=30d)`)

  // ── 1. Reuse the whale-harvester sweep + dedupe ──
  const harvested = await harvestGmgnWallets('30d')

  // ── 2. ONE findMany: address → Wallet.id. Wallets not in DB are skipped. ──
  const addresses = [...new Set(harvested.map((w) => w.address))]
  let walletIdByAddress = new Map<string, string>()
  try {
    const rows = await prisma.wallet.findMany({
      where: { address: { in: addresses } },
      select: { id: true, address: true },
    })
    walletIdByAddress = new Map(
      rows.map((r) => [r.address.toLowerCase(), r.id]),
    )
  } catch (err) {
    console.error(
      `[gmgn-bootstrap] wallet lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ── 3. ONE findMany of existing SmartMoneyWallet rows for the guard ──
  const walletIds = [...walletIdByAddress.values()]
  let existingByWalletId = new Map<string, ExistingSmwGuard>()
  try {
    const rows = await prisma.smartMoneyWallet.findMany({
      where: { walletId: { in: walletIds } },
      select: { walletId: true, sampleCount: true, reasons: true },
    })
    existingByWalletId = new Map(
      rows.map((r) => [
        r.walletId,
        { sampleCount: r.sampleCount, reasons: r.reasons },
      ]),
    )
  } catch (err) {
    console.error(
      `[gmgn-bootstrap] smart-money-wallet lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ── 4. Per-wallet bootstrap, failure-isolated ──
  let inDb = 0
  let upserted = 0
  let skipped = 0
  let unknown = 0
  let watchlist = 0
  let provisional = 0
  let failures = 0

  for (const w of harvested) {
    const walletId = walletIdByAddress.get(w.address.toLowerCase())
    if (!walletId) {
      continue
    }
    inDb += 1

    const row = gmgnBootstrapInput(w)
    const verdict = gmgnStatusFor(row)
    if (verdict.status === 'UNKNOWN') unknown += 1
    else if (verdict.status === 'WATCHLIST') watchlist += 1
    else if (verdict.status === 'PROVISIONAL') provisional += 1

    if (isRicherClassification(existingByWalletId.get(walletId))) {
      skipped += 1
      continue
    }

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
      upserted += 1
    } catch (err) {
      failures += 1
      console.error(
        `[gmgn-bootstrap] upsert failed for ${w.address}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  console.log(
    `[gmgn-bootstrap] harvested=${harvested.length} inDb=${inDb} upserted=${upserted} skipped=${skipped} ` +
      `unknown=${unknown} watchlist=${watchlist} provisional=${provisional} failures=${failures}`,
  )

  process.exit(0)
}

main().catch((err) => {
  console.error('[gmgn-bootstrap] FATAL:', err)
  process.exit(1)
})
