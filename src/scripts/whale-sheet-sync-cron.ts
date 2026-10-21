#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Whale scanner → sheet sync (standalone wrapper).
//
// Same sync the 10-minute whale-buy scan runs at the end of each pass, but
// invokable on its own — useful after a manual DB fix, or to repair the tab
// without waiting for the next scan.
//
// Run: npm run cron:whale-sheet-sync
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'

import { loadWhaleBuys } from '@/lib/modules/derived/whale-buy-store'
import { loadWhaleRegistry } from '@/lib/modules/derived/whale-wallet-registry'
import {
  syncWhaleScanSheet,
  syncWhaleWalletSheet,
  WHALE_SCAN_TAB,
  WHALE_WALLET_TAB,
} from '@/lib/modules/derived/whale-sheet-sync'

async function main(): Promise<void> {
  console.log(
    `[whale-sheet-sync] ${new Date().toISOString()} — starting ` +
      `tabs=${WHALE_SCAN_TAB},${WHALE_WALLET_TAB}`,
  )

  const rows = await loadWhaleBuys()
  const candidates = await syncWhaleScanSheet(rows)
  console.log(
    `[whale-sheet-sync] ${WHALE_SCAN_TAB}: ` +
      `${candidates.skipped ? 'unchanged (skipped)' : candidates.written === 0 ? 'WRITE FAILED' : 'rewritten'} ` +
      `(${candidates.written} rows, candidates=${rows.length})`,
  )

  const registry = loadWhaleRegistry()
  const wallets = await syncWhaleWalletSheet(registry)
  console.log(
    `[whale-sheet-sync] ${WHALE_WALLET_TAB}: ` +
      `${wallets.skipped ? 'unchanged (skipped)' : wallets.written === 0 ? 'WRITE FAILED' : 'rewritten'} ` +
      `(${wallets.written} rows, registry=${registry.length})`,
  )
}
main()
  .catch((err) => {
    console.error('[whale-sheet-sync] FATAL:', err)
  })
  .finally(() => {
    process.exit(0)
  })
