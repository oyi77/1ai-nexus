#!/usr/bin/env node
// -------------------------------------------------------------
// Wallet refresh cron: batch classify → persist SmartMoneyWallet
// Reads: Wallets whose last classification is stale (24h) or never classified.
// Writes: SmartMoneyWallet upserts via persistWalletClassification.
//         data/wallet-buys-latest.json — fresh buys for sniper discovery.
// Safe: idempotent, no double-count, throttle, read-only RPC.
// Run: npm run cron:wallet-refresh
// -------------------------------------------------------------

import 'dotenv/config'
import { runWalletRefreshBatch } from '@/lib/modules/derived/wallet-refresh'
import { foldWalletBuys } from '@/lib/modules/derived/wallet-discovery'
import { saveWalletBuys } from '@/lib/modules/derived/db-wallet-buys'
import type { NormalizedSwap } from '@/lib/modules/derived/solana-harvest'

/**
 * Persist fresh wallet buys for the sniper scan. The harvest already paid
 * the RPC cost, so discovery reads this artifact instead of re-harvesting.
 * A wallet with no complete buy simply contributes nothing — never a
 * fabricated row.
 *
 * DB-primary via saveWalletBuys (WalletBuySignal upsert by contract) with
 * the JSON artifact as a crash-safe dual-write backup. Never throws.
 */
async function writeWalletBuysArtifact(
  swapsByWallet: Array<{ wallet: string; swaps: unknown[] }>,
  windowMin: number,
): Promise<void> {
  const now = Date.now()
  const candidates = foldWalletBuys(
    swapsByWallet.map((w) => ({ wallet: w.wallet, swaps: w.swaps as NormalizedSwap[] })),
    { now, sinceMs: now - windowMin * 60_000 },
  )
  await saveWalletBuys(
    candidates.map((c) => ({
      contract: c.contract,
      chain: c.chain,
      buyers: c.buyers,
      buyVolumeUsd: c.buyVolumeUsd,
      buyCount: c.buyCount,
      firstBuyAt: c.firstBuyAt,
      lastBuyAt: c.lastBuyAt,
    })),
    'wallet-refresh',
    windowMin,
  )
  console.log(`[wallet-refresh] persisted ${candidates.length} wallet-buy candidate(s)`)
}

async function main() {
  console.log('[wallet-refresh] batch start')
  const res = await runWalletRefreshBatch()
  const windowMin = Number(process.env.WALLET_BUYS_WINDOW_MIN) || 60
  await writeWalletBuysArtifact(res.swapsByWallet, windowMin)
  console.log(
    `[wallet-refresh] candidates=${res.candidates} processed=${res.processed} ` +
    `succeeded=${res.succeeded} failed=${res.failed}`
  )
  if (res.candidates === 0) {
    // The whole Fase 3 pipeline is CORRECT and IDLE: no Solana wallet rows
    // exist in the DB (measured 2026-10-12: 6 rows carry chain='solana' but
    // are 0x… EVM addresses, filtered out by isBase58Addr). Until real
    // wallets are ingested (scripts/import-wallets.ts), classification,
    // whale evidence, AND sniper discovery all have zero input.
    console.warn(
      '[wallet-refresh] NO Solana wallets in Wallet table — classification, whale evidence, ' +
        'and sniper wallet-discovery are idle. Ingest real wallets with scripts/import-wallets.ts.',
    )
  }
  for (const r of res.results) {
    const cls = r.classification
    const whale = r.whaleGates
    console.log(
      `[wallet-refresh]   ${r.address} ${r.success ? 'OK' : 'FAIL'}` +
      (cls ? ` status=${cls.status} pnl=${cls.pnl30d?.toFixed(4) ?? 'n/a'} wr=${cls.winRate?.toFixed(4) ?? 'n/a'} n=${cls.episodesUsed} conf=${cls.confidence}` : '') +
      (whale ? ` whale=[pos=${whale.maxSinglePositionUsd} port=${whale.portfolioUsd} vol=${whale.buyVolume30dUsd}]` : '')
    )
    if (!r.success) {
      // A bare FAIL hides the cause and makes a throttling problem look
      // identical to a dead wallet or a schema break. Always name it.
      console.warn(`[wallet-refresh]   ↳ reason: ${r.error ?? 'unknown'}`)
    }
  }
  if (res.failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[wallet-refresh] failed:', e)
  process.exit(1)
})
