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

/**
 * First-seen-whale detection: buy legs from wallets NOT in the known set
 * become Wallet-ingestion leads with label 'first-seen-whale'.
 *
 * Built from the SAME harvest the artifact writer above used — zero extra
 * RPC cost. Only complete, historically-priced buy legs qualify (the same
 * classifyBuy gate the candidate path uses). Buy legs from null/zero-USD
 * are skipped by the pure detector — never fabricated.
 *
 * Never throws; a dead DB degrades to "logged, skipped".
 */
async function detectAndPersistFirstSeen(
  swapsByWallet: Array<{ wallet: string; swaps: unknown[] }>,
): Promise<void> {
  const { classifyBuy } = await import('@/lib/modules/derived/wallet-discovery')
  const { detectFirstSeenWhale, toFirstSeenWalletRows, firstSeenMinUsdFromEnv } = await import(
    '@/lib/modules/derived/first-seen-whale'
  )
  const { prisma } = await import('@/lib/db')
  const { SOL_MINT } = await import('@/lib/modules/derived/solana-harvest')

  try {
    // Build BuyLeg[] for Solana buy legs only (this cron harvests Solana).
    const legs: Array<{ wallet: string; contract: string; chain: string; usd: number; timestamp: number | null }> = []
    for (const { swaps } of swapsByWallet) {
      for (const raw of swaps as NormalizedSwap[]) {
        if (raw.completeness !== 'complete') continue
        if (raw.inputMint !== SOL_MINT) continue
        if (!raw.outputMint || raw.outputMint === SOL_MINT) continue
        const buy = classifyBuy(raw, raw.walletAddress)
        if (!buy.ok) continue
        legs.push({
          wallet: raw.walletAddress,
          contract: raw.outputMint,
          chain: 'solana',
          usd: buy.amountUsd,
          timestamp: raw.timestamp,
        })
      }
    }
    if (legs.length === 0) {
      console.log('[wallet-refresh] first-seen: no buy legs — skipped')
      return
    }

    // Known = every address in Wallet + every classified SmartMoneyWallet.
    let known: Set<string>
    try {
      const [wallets, classified] = await Promise.all([
        prisma.wallet.findMany({ select: { address: true } }),
        prisma.smartMoneyWallet.findMany({ select: { wallet: { select: { address: true } } } }),
      ])
      known = new Set([
        ...wallets.map((w) => w.address),
        ...classified.map((c) => c.wallet.address).filter(Boolean),
      ])
    } catch (err) {
      console.error(`[wallet-refresh] first-seen: known-set load failed — skipped: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    const signals = detectFirstSeenWhale(legs, known, { minUsd: firstSeenMinUsdFromEnv() })
    if (signals.length === 0) {
      console.log(`[wallet-refresh] first-seen: ${legs.length} leg(s), 0 new-wallet signal(s)`)
      return
    }

    const rows = toFirstSeenWalletRows(signals)
    let created = 0
    let failed = 0
    for (const r of rows) {
      try {
        await prisma.wallet.upsert({
          where: { address: r.address },
          create: { address: r.address, chain: r.chain, labels: r.labels, lastSeen: new Date() },
          update: { lastSeen: new Date() },
        })
        created += 1
      } catch {
        failed += 1
      }
    }
    console.log(
      `[wallet-refresh] first-seen: ${legs.length} leg(s) → ${signals.length} signal(s) → ` +
        `${rows.length} lead(s) (created=${created} failed=${failed})`,
    )
  } catch (err) {
    console.error(`[wallet-refresh] first-seen: unexpected failure — skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main() {
  console.log('[wallet-refresh] batch start')
  const res = await runWalletRefreshBatch()
  const windowMin = Number(process.env.WALLET_BUYS_WINDOW_MIN) || 60
  await writeWalletBuysArtifact(res.swapsByWallet, windowMin)
  await detectAndPersistFirstSeen(res.swapsByWallet)
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
