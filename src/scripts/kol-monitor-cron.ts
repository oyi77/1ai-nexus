#!/usr/bin/env node
// -------------------------------------------------------------
// KOL + Axiom wallet monitor cron.
//
// Two complementary sources of verified-human smart-money buys:
//   1. KOLScan (kolscan.io) — live feed of KOL wallet purchases
//      Gate: purchase >= $1000, GMGN winrate >= 60%, coord-replica filter
//   2. Axiom (axiom.trade) — GMGN axiom-tagged wallets
//      Gate: winrate >= 60%, fastTxRatio < 50% (human), buys >= 10
//
// Outputs:
//   - appends UNSEEN screened wallet buys into data/wallet-buys-latest.json
//     (same artifact format as wallet-refresh-cron.ts) so the sniper scan
//     can pick up KOL/Axiom-discovered candidates without a separate path.
//     Signature dedup via data/kolscan-seen.json — a buy is only counted
//     and folded once across 5-minute runs.
//   - persists gate-passing wallets into the Wallet table (chain='solana')
//     so wallet-refresh-cron can harvest their on-chain buys.
//   - sends ONE consolidated Telegram digest when the gate actually passes
//     (new Axiom wallets or unseen KOLScan buys).
//   - appends gate passers to the operator's Google wallet sheet (best-effort).
//
// Schedule: every 5 minutes via crontab
//   */5 * * * * cd /home/openclaw/projects/1ai-tracker && npm run cron:kol-monitor >> /tmp/kol-monitor.log 2>&1
//
// Env:
//   KOL_MONITOR_ENABLED — "true" to enable the cron at all (default OFF).
//                          Mirrors SNIPER_CONFLUENCE_ENABLED / SNIPER_REALTIME_ENABLED:
//                          the entire script (KOLScan + Axiom + Telegram) is a no-op
//                          unless the literal "true".
//   KOLSCAN_SESSION — optional kolscan.io session cookie; NOT required.
//                      The live feed reads KOLScan's public Supabase REST
//                      keyless, so this cookie never gates the source.
//   KOLSCAN_ENABLED — "true" to enable KOLScan source (default: false)
// -------------------------------------------------------------

import 'dotenv/config'
import { setTimeout as sleep } from 'node:timers/promises'
import { saveWalletBuys, loadWalletBuys, type WalletBuyRow } from '@/lib/modules/derived/db-wallet-buys'
import { fetchKolscanFeed, screenKolscanTransactions, resolveKolscanThresholds, type KolscanScreenedTx } from '@/lib/modules/meme/kolscan'
import { kolscanTxToNormalizedSwap } from '@/lib/modules/meme/kolscan/adapter'
import { filterUnseenTransactionsDb, markTransactionsSeenDb } from '@/lib/modules/meme/kolscan/seen'
import { fetchAxiomWallets, type AxiomWallet } from '@/lib/modules/meme/axiom-monitor'
import { listGmgnWalletRank } from '@/lib/modules/meme/gmgn'
import {
  buildKolAxiomDigest,
  findWalletsMissingLabel,
  persistMonitoredWallets,
  toMonitoredWallet,
} from '@/lib/modules/meme/wallet-persist'
import { exportGatePassersToSheet } from '@/lib/modules/meme/sheet-export'
import { foldWalletBuys } from '@/lib/modules/derived/wallet-discovery'
import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper'
import type { NormalizedSwap } from '@/lib/modules/derived/solana-harvest'

async function buildWinRateMap(): Promise<Map<string, number | null>> {
  const wrMap = new Map<string, number | null>()
  for (const tag of ['smart_degen', 'sniper', 'kol', 'axiom'] as const) {
    try {
      const rows = await listGmgnWalletRank(tag, '30d')
      for (const r of rows) {
        if (!wrMap.has(r.address)) {
          wrMap.set(r.address, r.winRate30d)
        }
      }
    } catch {
      // tag fetch failure is non-fatal — other tags still populate the map
    }
    await sleep(800)
  }
  return wrMap
}

/** Operator DM chain — mirrors reviewChatId() in confluence-cron.ts and
 * paper-buy-cron.ts; deliberately does NOT fall back to the sale channel. */
function reviewChatId(): string {
  return (
    process.env.SNIPER_REVIEW_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  )
}

async function main() {
  // Master env gate (mirrors SNIPER_CONFLUENCE_ENABLED in confluence-cron.ts):
  // the whole cron — KOLScan feed, Axiom scan, Telegram digest — is a no-op
  // unless the literal "true". Nothing here may reach the sale channel unopted-in.
  if (process.env.KOL_MONITOR_ENABLED !== 'true') {
    console.log("[kol-monitor] disabled (KOL_MONITOR_ENABLED != 'true')")
    return
  }

  console.log(`[kol-monitor] ${new Date().toISOString()} — starting`)

  // ── Source 1: KOLScan live feed ──
  const kolscanEnabled = process.env.KOLSCAN_ENABLED === 'true'
  let kolscanScreened = 0
  let kolscanUnseen = 0
  let kolscanPersisted = 0
  let kolscanPersistFailed = 0
  const unseenScreenedTxs: KolscanScreenedTx[] = []

  if (kolscanEnabled) {
    try {
      const feed = await fetchKolscanFeed()
      console.log(`[kol-monitor] KOLScan: ${feed.wallets.length} wallets, ${feed.transactions.length} txs`)

      const winRates = await buildWinRateMap()
      console.log(`[kol-monitor] GMGN win-rate map: ${winRates.size} wallets`)

      // Operator-overridable thresholds (KOLSCAN_MIN_PURCHASE_USD /
      // KOLSCAN_MIN_WINRATE); defaults to KOLSCAN_THRESHOLDS when unset.
      const thresholds = resolveKolscanThresholds()

      const screened = screenKolscanTransactions(feed.transactions, {
        winRates,
        minPurchaseUsd: thresholds.minPurchaseUsd,
        minWinRate: thresholds.minWinRate,
      })
      kolscanScreened = screened.length
      console.log(`[kol-monitor] KOLScan screened: ${screened.length} txs passed gate`)

      // Dedup by signature BEFORE folding — the same buy must never be
      // re-counted on the next 5-minute run.
      const unseen = await filterUnseenTransactionsDb(screened)
      kolscanUnseen = unseen.length
      console.log(`[kol-monitor] KOLScan unseen: ${unseen.length}/${screened.length} txs`)
      unseenScreenedTxs.push(...unseen)

      // Persist screened wallets so wallet-refresh-cron can harvest them.
      const walletAddrs = [...new Set(screened.map((tx) => tx.walletAddress))]
      const persist = await persistMonitoredWallets(
        walletAddrs.map((addr) => toMonitoredWallet(addr, 'kolscan')),
      )
      kolscanPersisted = persist.upserted
      kolscanPersistFailed = persist.failed
      console.log(`[kol-monitor] KOLScan wallets persisted: ${persist.upserted} upserted, ${persist.failed} failed`)

      // Group UNSEEN screened txs by wallet for the fold.
      const swapsByWallet = new Map<string, NormalizedSwap[]>()
      for (const tx of unseen) {
        const swap = kolscanTxToNormalizedSwap(tx)
        let arr = swapsByWallet.get(tx.walletAddress)
        if (!arr) {
          arr = []
          swapsByWallet.set(tx.walletAddress, arr)
        }
        arr.push(swap)
      }

      if (swapsByWallet.size > 0) {
        const allSwaps = [...swapsByWallet].map(([wallet, swaps]) => ({ wallet, swaps }))
        const now = Date.now()
        const windowMin = Number(process.env.WALLET_BUYS_WINDOW_MIN) || 60
        const candidates = foldWalletBuys(allSwaps, {
          now,
          sinceMs: now - windowMin * 60_000,
          minBuyUsd: thresholds.minPurchaseUsd,
        })

        // Merge with existing candidates (DB-first, dedup by contract).
        const existing = await loadWalletBuys()
        const byContract = new Map<string, WalletBuyRow>()

        if (existing) {
          for (const c of existing) {
            byContract.set(c.contract, c)
          }
        }

        for (const c of candidates) {
          const hit = byContract.get(c.contract)
          if (hit) {
            // Merge: union buyers, sum volume/count, extend time range.
            const buyers = new Set([...hit.buyers, ...c.buyers])
            byContract.set(c.contract, {
              contract: c.contract,
              chain: c.chain,
              buyers: [...buyers],
              buyVolumeUsd: hit.buyVolumeUsd + c.buyVolumeUsd,
              buyCount: hit.buyCount + c.buyCount,
              firstBuyAt: Math.min(hit.firstBuyAt ?? 0, c.firstBuyAt),
              lastBuyAt: Math.max(hit.lastBuyAt ?? 0, c.lastBuyAt),
            })
          } else {
            byContract.set(c.contract, {
              contract: c.contract,
              chain: c.chain,
              buyers: c.buyers,
              buyVolumeUsd: c.buyVolumeUsd,
              buyCount: c.buyCount,
              firstBuyAt: c.firstBuyAt,
              lastBuyAt: c.lastBuyAt,
            })
          }
        }

        await saveWalletBuys([...byContract.values()], 'kol-monitor', windowMin)
        console.log(`[kol-monitor] persisted ${candidates.length} new candidate(s) (total: ${byContract.size})`)

        // Mark seen only AFTER the merge succeeds — a crash mid-merge can
        // still re-fold the same buys on the next run.
        await markTransactionsSeenDb(unseen)
      }
    } catch (err) {
      console.error(`[kol-monitor] KOLScan failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    console.log('[kol-monitor] KOLScan disabled (set KOLSCAN_ENABLED=true; no cookie needed)')
  }

  // ── Source 2: Axiom wallet list ──
  let axiomWallets: AxiomWallet[] = []
  let newAxiomWallets: AxiomWallet[] = []
  let axiomPersisted = 0
  let axiomPersistFailed = 0
  try {
    axiomWallets = await fetchAxiomWallets()
    console.log(`[kol-monitor] Axiom: ${axiomWallets.length} wallets passed gate (winrate>=60% + human)`)

    // NEW = not yet carrying the 'axiom' label. Checked BEFORE the upsert so
    // the digest fires only the first time a wallet passes the gate.
    const addrs = axiomWallets.map((w) => w.address)
    const newAddrs = await findWalletsMissingLabel(addrs, 'axiom')
    newAxiomWallets = axiomWallets.filter((w) => newAddrs.includes(w.address))
    console.log(`[kol-monitor] Axiom new wallets: ${newAxiomWallets.length}/${axiomWallets.length}`)

    const persist = await persistMonitoredWallets(
      axiomWallets.map((w) => toMonitoredWallet(w.address, 'axiom')),
    )
    axiomPersisted = persist.upserted
    axiomPersistFailed = persist.failed
    console.log(`[kol-monitor] Axiom wallets persisted: ${persist.upserted} upserted, ${persist.failed} failed`)

    // Log top 3 for visibility.
    for (const w of axiomWallets.slice(0, 3)) {
      console.log(`[kol-monitor]   ${w.address.slice(0, 16)}... wr=${((w.winRate30d ?? 0) * 100).toFixed(0)}% pnl=${w.pnl30d !== null ? (w.pnl30d * 100).toFixed(0) + '%' : '?'} tags=[${w.tags.slice(0, 3).join(',')}]`)
    }
  } catch (err) {
    console.error(`[kol-monitor] Axiom failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Telegram notification: only when the gate actually passed ──
  const digest = buildKolAxiomDigest({
    axiom: newAxiomWallets.map((w) => ({
      address: w.address,
      winRate30d: w.winRate30d,
      pnl30d: w.pnl30d,
    })),
    kolscan: unseenScreenedTxs.map((tx) => ({
      kolName: tx.kolName,
      outTokenSymbol: tx.outTokenSymbol,
      outTokenAddress: tx.outTokenAddress,
      usdValue: tx.usdValue,
      dex: tx.dex,
    })),
  })
  if (digest) {
    const chat = reviewChatId()
    if (chat) {
      const sent = await deliverSniperAlert(digest, chat)
      console.log(`[kol-monitor] telegram digest ${sent ? 'sent' : 'rejected/unconfigured'} to review chat`)
    } else {
      console.log('[kol-monitor] telegram digest skipped (no review chat configured)')
    }
  } else {
    console.log('[kol-monitor] no new gate passers — skipping telegram digest')
  }

  // ── Google Sheet export: gate passers, best-effort ──
  // New Axiom wallets + unseen KOLScan buys only — the sheet has no dedup,
  // so appending the same rows every 5 minutes would bloat the wallet source.
  try {
    const sheet = await exportGatePassersToSheet({
      axiom: newAxiomWallets,
      kolscan: unseenScreenedTxs,
    })
    console.log(`[kol-monitor] sheet export: axiom=${sheet.axiomAdded} kolscan=${sheet.kolscanAdded}`)
  } catch (err) {
    console.error(`[kol-monitor] sheet export failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  console.log(
    `[kol-monitor] done: kolscan_screened=${kolscanScreened} kolscan_unseen=${kolscanUnseen} ` +
    `kolscan_persisted=${kolscanPersisted}/${kolscanPersistFailed} ` +
    `axiom_persisted=${axiomPersisted}/${axiomPersistFailed}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('[kol-monitor] FATAL:', err)
  process.exit(1)
})
