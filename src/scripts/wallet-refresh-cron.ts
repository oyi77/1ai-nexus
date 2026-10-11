#!/usr/bin/env node
// -------------------------------------------------------------
// Wallet refresh cron: batch classify → persist SmartMoneyWallet
// Reads: Wallets whose last classification is stale (24h) or never classified.
// Writes: SmartMoneyWallet upserts via persistWalletClassification.
// Safe: idempotent, no double-count, throttle, read-only RPC.
// Run: npm run cron:wallet-refresh
// -------------------------------------------------------------

import 'dotenv/config'
import { runWalletRefreshBatch } from '@/lib/modules/derived/wallet-refresh'

async function main() {
  console.log('[wallet-refresh] batch start')
  const res = await runWalletRefreshBatch()
  console.log(
    `[wallet-refresh] candidates=${res.candidates} processed=${res.processed} ` +
    `succeeded=${res.succeeded} failed=${res.failed}`
  )
  for (const r of res.results) {
    const cls = r.classification
    const whale = r.whaleGates
    console.log(
      `[wallet-refresh]   ${r.address} ${r.success ? 'OK' : 'FAIL'}` +
      (cls ? ` status=${cls.status} pnl=${cls.pnl30d?.toFixed(4) ?? 'n/a'} wr=${cls.winRate?.toFixed(4) ?? 'n/a'} n=${cls.episodesUsed} conf=${cls.confidence}` : '') +
      (whale ? ` whale=[pos=${whale.maxSinglePositionUsd} port=${whale.portfolioUsd} vol=${whale.buyVolume30dUsd}]` : '')
    )
  }
  if (res.failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[wallet-refresh] failed:', e)
  process.exit(1)
})
