#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Whale list cleanup — remove the wr=0/pnl=0 leak from gmgn-bootstrap.
//
// Read-only intent: find `SmartMoneyWallet` rows written by the GMGN
// bootstrap bridge that carry winRate<=0 AND pnl30d<=0 (the exact leak
// that shipped 46 zero-quality rows into the whale list), then delete the
// corresponding plain `Wallet` row — but ONLY when the Wallet still carries
// a whale-harvest / whale-verification label AND has no Transaction /
// TokenHolding rows (never delete a wallet that earned on-chain data).
//
// DESTRUCTIVE — safe by default:
//   WHALE_LIST_CLEANUP_CONFIRM=true  → actually delete
//   (unset / any other value)        → DRY-RUN, prints what it would delete
//
// Per-wallet prisma transactions; counts + logs each deletion with address.
// Never throws overall; final line is always:
//   [whale-list-cleanup] deleted=<n> skipped=<n> failures=<n>
//
// Run: npm run cleanup:whale-list
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { prisma } from '@/lib/db'

const CONFIRM = process.env.WHALE_LIST_CLEANUP_CONFIRM === 'true'
const LEAK_CATEGORY = 'gmgn-bootstrap'
const WHALE_LIST_LABELS = ['whale-harvest', 'whale-verification'] as const

interface LeakRow {
  id: string
  walletId: string
  winRate: number | null
  pnl30d: number | null
  wallet: {
    address: string
    labels: string[]
  }
}

async function main(): Promise<void> {
  console.log(
    `[whale-list-cleanup] ${new Date().toISOString()} — mode=${CONFIRM ? 'DELETE' : 'DRY-RUN'}`,
  )

  let candidates: LeakRow[] = []
  try {
    candidates = await prisma.smartMoneyWallet.findMany({
      where: {
        category: LEAK_CATEGORY,
        winRate: { lte: 0 },
        pnl30d: { lte: 0 },
      },
      select: {
        id: true,
        walletId: true,
        winRate: true,
        pnl30d: true,
        wallet: { select: { address: true, labels: true } },
      },
    })
  } catch (err) {
    console.error(
      `[whale-list-cleanup] smart-money-wallet lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    console.log('[whale-list-cleanup] deleted=0 skipped=0 failures=1')
    process.exit(0)
  }

  let deleted = 0
  let skipped = 0
  let failures = 0

  for (const row of candidates) {
    const { walletId } = row
    const address = row.wallet.address
    const wr = row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : 'null'
    const pnl = row.pnl30d !== null ? `${Math.round(row.pnl30d * 100)}%` : 'null'

    // 1. Only wallets still carrying a whale-list label are in scope.
    if (!row.wallet.labels.some((l) => (WHALE_LIST_LABELS as readonly string[]).includes(l))) {
      console.log(
        `[whale-list-cleanup] skip ${address} wr=${wr} pnl=${pnl} — Wallet labels ${JSON.stringify(row.wallet.labels)} not whale-harvest/whale-verification`,
      )
      skipped += 1
      continue
    }

    // 2. Never delete a wallet that has earned on-chain data.
    let hasTransactions = false
    let hasHoldings = false
    try {
      ;[hasTransactions, hasHoldings] = await Promise.all([
        prisma.transaction.count({ where: { walletId } }).then((n) => n > 0),
        prisma.tokenHolding.count({ where: { walletId } }).then((n) => n > 0),
      ])
    } catch (err) {
      console.error(
        `[whale-list-cleanup] on-chain reference check failed for ${address}: ${err instanceof Error ? err.message : String(err)}`,
      )
      failures += 1
      continue
    }

    if (hasTransactions || hasHoldings) {
      console.log(
        `[whale-list-cleanup] skip ${address} wr=${wr} pnl=${pnl} — has Transaction=${hasTransactions} TokenHolding=${hasHoldings}`,
      )
      skipped += 1
      continue
    }

    if (!CONFIRM) {
      console.log(
        `[whale-list-cleanup] WOULD DELETE ${address} wr=${wr} pnl=${pnl} (gmgn-bootstrap leak)`,
      )
      deleted += 1
      continue
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Deleting the Wallet cascades its SmartMoneyWallet (schema relation).
        await tx.wallet.delete({ where: { id: walletId } })
      })
      console.log(
        `[whale-list-cleanup] DELETED ${address} wr=${wr} pnl=${pnl} (gmgn-bootstrap leak)`,
      )
      deleted += 1
    } catch (err) {
      failures += 1
      console.error(
        `[whale-list-cleanup] delete failed for ${address}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  console.log(
    `[whale-list-cleanup] deleted=${deleted} skipped=${skipped} failures=${failures}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('[whale-list-cleanup] FATAL:', err)
  process.exit(1)
})
