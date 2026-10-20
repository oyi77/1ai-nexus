#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Whale-buy scanner cron — thin main() wrapper.
//
// Runs the token-first autonomous whale-buy scan:
//   1. discover candidate tokens (GMGN trending)
//   2. per token: fetch holders + wallet activity
//   3. detect whale-sized buys (BUY legs with real USD >= threshold)
//   4. classify buyers (SmartMoneyWallet DB → walletClass / FIRST_SEEN)
//   5. persist to WalletBuySignal DB (source='whale-buy-scanner') + JSON
//   6. mark seen tokens to prevent re-emission within cooldown
//
// Receipt logging + exit codes. Scheduling is crontab-based, not
// in-process setInterval (mirrors confluence-cron.ts).
//
// Run: npm run cron:whale-buy-scan
// Env:
//   WHALE_SCAN_LIMIT       — tokens per pass (default 6; pass must finish inside the 10-min schedule)
//   WHALE_HOLDER_LIMIT     — holders per token to scan (default 6)
//   WHALE_MIN_USD          — min USD for whale buy threshold (default 10000)
//   WHALE_BUYS_DB          — 'off' skips DB writes (tests)
//   WHALE_BUYS_PATH        — override JSON artifact path
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'

import { scanWhaleBuys } from '@/lib/modules/derived/whale-buy-scanner'
import { saveWhaleBuys, pruneStaleWhaleBuys, loadWhaleBuys } from '@/lib/modules/derived/whale-buy-store'
import { join } from 'node:path'
import { acquireRunLock } from '@/lib/modules/derived/run-lock'
import { syncWhaleScanSheet, syncWhaleWalletSheet } from '@/lib/modules/derived/whale-sheet-sync'
import { isWhaleBuySeen, markWhaleBuySeen } from '@/lib/modules/derived/db-seen-store'
import {
  loadWhaleRegistry,
  saveWhaleRegistry,
  mergeWhaleRegistry,
  loadWhaleIdentities,
} from '@/lib/modules/derived/whale-wallet-registry'

function numEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Lock path for this cron — a pass may outlive the 10-minute schedule. */
const LOCK_PATH = join(process.cwd(), 'data', '.whale-buy-scan.lock')
/** Reclaim after this long so a crashed pass can never wedge the cron. */
const LOCK_STALE_MS = 30 * 60_000

async function main(): Promise<void> {
  const lock = acquireRunLock(LOCK_PATH, LOCK_STALE_MS)
  if (!lock.acquired) {
    console.log('[whale-buy-scan] another pass is running — skipping this cycle')
    return
  }

  const now = Date.now()
  const tokenLimit = numEnv('WHALE_SCAN_LIMIT', 6)
  const holderLimit = numEnv('WHALE_HOLDER_LIMIT', 6)
  const minUsd = numEnv('WHALE_MIN_USD', 10_000)

  console.log(
    `[whale-buy-scan] ${new Date(now).toISOString()} — starting ` +
      `(tokenLimit=${tokenLimit} holderLimit=${holderLimit} minUsd=${minUsd})`,
  )

  const result = await scanWhaleBuys({
    tokenLimit,
    holderLimit,
    config: { minUsd },
    filterSeen: isWhaleBuySeen,
  })

  console.log(
    `[whale-buy-scan] scanned tokens=${result.tokensScanned} ` +
      `holders=${result.holdersFetched} ` +
      `detections=${result.detections.length} ` +
      `aggregated=${result.aggregated.length} ` +
      `errors=${result.errors.length}`,
  )

  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 10)) {
      console.log(`[whale-buy-scan]   error: ${e}`)
    }
  }

  // Filter out already-seen tokens (cooldown dedup), then persist new ones.
  const newRows = []
  let suppressed = 0
  for (const row of result.aggregated) {
    if (await isWhaleBuySeen(row.chain, row.contract)) {
      suppressed++
      continue
    }
    newRows.push(row)
  }

  if (suppressed > 0) {
    console.log(`[whale-buy-scan] suppressed (seen cooldown): ${suppressed}`)
  }

  if (newRows.length > 0) {
    await saveWhaleBuys(newRows)
    for (const row of newRows) {
      await markWhaleBuySeen(row.chain, row.contract)
    }
    console.log(
      `[whale-buy-scan] saved ${newRows.length} whale-buy signal(s) ` +
        `→ WalletBuySignal DB + data/whale-buys-latest.json`,
    )
  } else {
    console.log('[whale-buy-scan] no new whale-buy signals to persist')
  }

  // Prune stale rows (older than 6h).
  const pruned = await pruneStaleWhaleBuys(360)
  if (pruned > 0) {
    console.log(`[whale-buy-scan] pruned ${pruned} stale row(s)`)
  }

  // 7. Mirror the scanner's current candidate set to the operator sheet.
  //    Full rewrite from the DB (source of truth), so the tab always equals
  //    what the scanner holds — never an append log.
  const sheetRows = await loadWhaleBuys()
  const sheetWritten = await syncWhaleScanSheet(sheetRows)
  console.log(`[whale-buy-scan] sheet rows written: ${sheetWritten} (candidates=${sheetRows.length})`)

  // 8. Fold this pass's buyers into the persistent whale registry, then
  //    rewrite the whale-wallet tab. The registry outlives the 6h prune, so
  //    the sheet stays cumulative while still reflecting current activity.
  const registry = mergeWhaleRegistry(
    loadWhaleRegistry(),
    result.aggregated,
    await loadWhaleIdentities(result.aggregated.flatMap((r) => r.buyers ?? [])),
    now,
  )
  saveWhaleRegistry(registry)
  const walletWritten = await syncWhaleWalletSheet(registry)
  console.log(
    `[whale-buy-scan] whale-wallet tab rows: ${walletWritten} (registry=${registry.length})`,
  )

  // Print detection summary for the receipt.
  for (const d of result.detections.slice(0, 5)) {
    console.log(
      `[whale-buy-scan]   ${d.contract} | wallet=${d.wallet.slice(0, 8)}… ` +
        `$${Math.round(d.usdValue).toLocaleString()} ` +
        `class=${d.walletClass} firstSeen=${d.isFirstSeen} holder=${d.isCurrentHolder}`,
    )
  }

  console.log(
    `[whale-buy-scan] done: tokens=${result.tokensScanned} ` +
      `detections=${result.detections.length} saved=${newRows.length} ` +
      `suppressed=${suppressed} errors=${result.errors.length}`,
  )

  lock.release()
}

main()
  .catch((err) => {
    console.error('[whale-buy-scan] FATAL:', err)
  })
  .finally(() => {
    process.exit(0)
  })
