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
// Output: appends screened wallet buys into data/wallet-buys-latest.json
// (same artifact format as wallet-refresh-cron.ts) so the sniper scan
// can pick up KOL/Axiom-discovered candidates without a separate path.
//
// Schedule: every 5 minutes via crontab
//   */5 * * * * cd /home/openclaw/projects/1ai-tracker && npm run cron:kol-monitor >> /tmp/kol-monitor.log 2>&1
//
// Env:
//   KOLSCAN_SESSION — kolscan.io session cookie (required for KOLScan feed)
//   KOLSCAN_ENABLED — "true" to enable KOLScan source (default: false)
// -------------------------------------------------------------

import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchKolscanFeed, screenKolscanTransactions, KOLSCAN_THRESHOLDS } from '@/lib/modules/meme/kolscan'
import { kolscanTxToNormalizedSwap } from '@/lib/modules/meme/kolscan/adapter'
import { fetchAxiomWallets } from '@/lib/modules/meme/axiom-monitor'
import { listGmgnWalletRank } from '@/lib/modules/meme/gmgn'
import { foldWalletBuys } from '@/lib/modules/derived/wallet-discovery'
import type { NormalizedSwap } from '@/lib/modules/derived/solana-harvest'

interface WalletBuysArtifact {
  generated_at: string
  min_usd: number
  window_min: number
  candidates: Array<{
    contract: string
    chain: string
    buyers: string[]
    buyVolumeUsd: number
    buyCount: number
    firstBuyAt: number
    lastBuyAt: number
  }>
}

async function readExistingArtifact(path: string): Promise<WalletBuysArtifact | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as WalletBuysArtifact
  } catch {
    return null
  }
}

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
    await new Promise((r) => setTimeout(r, 800))
  }
  return wrMap
}

async function main() {
  const dir = join(process.cwd(), 'data')
  await mkdir(dir, { recursive: true })
  const artifactPath = process.env.WALLET_BUYS_PATH || join(dir, 'wallet-buys-latest.json')

  console.log(`[kol-monitor] ${new Date().toISOString()} — starting`)

  // ── Source 1: KOLScan live feed ──
  const kolscanEnabled = process.env.KOLSCAN_ENABLED === 'true'
  const kolscanSession = process.env.KOLSCAN_SESSION
  let kolscanScreened = 0
  const allSwaps: Array<{ wallet: string; swaps: NormalizedSwap[] }> = []

  if (kolscanEnabled && kolscanSession) {
    try {
      const feed = await fetchKolscanFeed()
      console.log(`[kol-monitor] KOLScan: ${feed.wallets.length} wallets, ${feed.transactions.length} txs`)

      const winRates = await buildWinRateMap()
      console.log(`[kol-monitor] GMGN win-rate map: ${winRates.size} wallets`)

      const screened = screenKolscanTransactions(feed.transactions, { winRates })
      kolscanScreened = screened.length
      console.log(`[kol-monitor] KOLScan screened: ${screened.length} txs passed gate`)

      // Group screened txs by wallet for the fold
      const swapsByWallet = new Map<string, NormalizedSwap[]>()
      for (const tx of screened) {
        const swap = kolscanTxToNormalizedSwap(tx)
        let arr = swapsByWallet.get(tx.walletAddress)
        if (!arr) {
          arr = []
          swapsByWallet.set(tx.walletAddress, arr)
        }
        arr.push(swap)
      }
      for (const [wallet, swaps] of swapsByWallet) {
        allSwaps.push({ wallet, swaps })
      }
    } catch (err) {
      console.error(`[kol-monitor] KOLScan failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    console.log('[kol-monitor] KOLScan disabled (set KOLSCAN_ENABLED=true + KOLSCAN_SESSION)')
  }

  // ── Source 2: Axiom wallet list ──
  // The Axiom monitor produces a wallet LIST (not txs). Those wallets are
  // ingested as tracked wallets by the existing wallet-refresh-cron, which
  // harvests their on-chain buys. Here we just log how many passed the gate
  // so the operator can verify the Axiom source is alive.
  try {
    const axiomWallets = await fetchAxiomWallets()
    console.log(`[kol-monitor] Axiom: ${axiomWallets.length} wallets passed gate (winrate>=60% + human)`)
    // Log top 3 for visibility
    for (const w of axiomWallets.slice(0, 3)) {
      console.log(`[kol-monitor]   ${w.address.slice(0, 16)}... wr=${((w.winRate30d ?? 0) * 100).toFixed(0)}% pnl=${w.pnl30d !== null ? (w.pnl30d * 100).toFixed(0) + '%' : '?'} tags=[${w.tags.slice(0, 3).join(',')}]`)
    }
  } catch (err) {
    console.error(`[kol-monitor] Axiom failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Merge into wallet-buys artifact ──
  if (allSwaps.length > 0) {
    const now = Date.now()
    const windowMin = Number(process.env.WALLET_BUYS_WINDOW_MIN) || 60
    const candidates = foldWalletBuys(allSwaps, {
      now,
      sinceMs: now - windowMin * 60_000,
      minBuyUsd: KOLSCAN_THRESHOLDS.minPurchaseUsd,
    })

    // Merge with existing artifact candidates (dedup by contract)
    const existing = await readExistingArtifact(artifactPath)
    const byContract = new Map<string, WalletBuysArtifact['candidates'][number]>()

    if (existing) {
      for (const c of existing.candidates) {
        byContract.set(c.contract, c)
      }
    }

    for (const c of candidates) {
      const hit = byContract.get(c.contract)
      if (hit) {
        // Merge: union buyers, sum volume/count, extend time range
        const buyers = new Set([...hit.buyers, ...c.buyers])
        byContract.set(c.contract, {
          contract: c.contract,
          chain: c.chain,
          buyers: [...buyers],
          buyVolumeUsd: hit.buyVolumeUsd + c.buyVolumeUsd,
          buyCount: hit.buyCount + c.buyCount,
          firstBuyAt: Math.min(hit.firstBuyAt, c.firstBuyAt),
          lastBuyAt: Math.max(hit.lastBuyAt, c.lastBuyAt),
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

    const out: WalletBuysArtifact = {
      generated_at: new Date(now).toISOString(),
      min_usd: KOLSCAN_THRESHOLDS.minPurchaseUsd,
      window_min: windowMin,
      candidates: [...byContract.values()],
    }
    await writeFile(artifactPath, JSON.stringify(out, null, 2))
    console.log(`[kol-monitor] wrote ${candidates.length} new candidate(s) → ${artifactPath} (total: ${byContract.size})`)
  } else {
    console.log('[kol-monitor] no screened swaps to merge')
  }

  console.log(`[kol-monitor] done: kolscan_screened=${kolscanScreened}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[kol-monitor] FATAL:', err)
  process.exit(1)
})
