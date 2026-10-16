// ─────────────────────────────────────────────────────────────
// Whale-buy scanner — producer (token-first autonomous scan).
//
// Orchestrates the token-first path the repo lacked:
//   1. Discover candidate tokens (GMGN trending / gecko new pools)
//   2. For each token: fetch GMGN token-holders + recent wallet activity
//      for the top holders (per-source failure isolation)
//   3. Run the pure detector → WhaleBuyDetection[]
//   4. Classify each buyer (SmartMoneyWallet DB lookup → walletClass)
//
// This fills the gap: WalletBuySignal table = 0 rows, wallet-buys-latest.json
// = []. The wallet-first path classifies ~5 wallets/day (too slow); the
// token-reactive path (wallet-tracer) only runs when the sniper already
// has a candidate. This scanner finds whale buys on NEW tokens proactively.
//
// Discipline (mirrors confluence-producer.ts):
//   · per-token failure is tolerated — one dead token must not zero the pass
//   · per-wallet failure is tolerated — one dead wallet must not zero a token
//   · politeness: >=200ms between wallet-activity fetches
//   · NEVER fabricates: missing USD stays null; missing data stays UNKNOWN
// ─────────────────────────────────────────────────────────────

import {
  discoverEstablishedGmgnTokens,
  listGmgnTokenHolders,
  type GmgnHolderRow,
} from '@/lib/modules/meme/gmgn'
import { fetchWalletActivity } from '@/lib/modules/derived/wallet-activity'
import type { NormalizedSwap } from '@/lib/modules/derived/solana-harvest'
import { prisma } from '@/lib/db'
import {
  detectWhaleBuys,
  aggregateWhaleBuyDetections,
  type WhaleBuyDetection,
  type WhaleBuyDetectorConfig,
} from '@/lib/modules/derived/whale-buy-detector'
import type { WalletStatus } from '@/lib/modules/derived/wallet-intel'

/** Politeness gap between wallet-activity fetches (ms). */
const WALLET_FETCH_GAP_MS = 200

export interface WhaleScanResult {
  /** All detections across all tokens in this scan pass. */
  detections: WhaleBuyDetection[]
  /** Per-contract aggregated rows ready for the store. */
  aggregated: Array<{
    contract: string
    chain: string
    buyers: string[]
    buyVolumeUsd: number
    buyCount: number
    firstBuyAt: number | null
    lastBuyAt: number | null
  }>
  /** One short string per failed token (honest accounting). */
  errors: string[]
  /** Number of candidate tokens scanned. */
  tokensScanned: number
  /** Number of holders fetched across all tokens. */
  holdersFetched: number
}

export interface WhaleScanOpts {
  /** Max candidate tokens to scan (env WHALE_SCAN_LIMIT, default 10). */
  tokenLimit?: number
  /** Max holders per token to fetch activity for (default 10). */
  holderLimit?: number
  /** Wallet-activity rows per holder (default 25). */
  swapLimit?: number
  /** Detector config (min USD threshold). */
  config?: Partial<WhaleBuyDetectorConfig>
}

function tokenLimitEnv(): number {
  const parsed = Number.parseInt(process.env.WHALE_SCAN_LIMIT ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
}

function holderLimitEnv(): number {
  const parsed = Number.parseInt(process.env.WHALE_HOLDER_LIMIT ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
}

/**
 * Load the classification status for a set of wallet addresses from the
 * SmartMoneyWallet DB. Returns a Map of address → WalletStatus.
 * Never throws — on failure returns an empty Map (all wallets = FIRST_SEEN).
 */
async function loadClassifiedWallets(
  addresses: string[],
): Promise<Map<string, WalletStatus>> {
  const out = new Map<string, WalletStatus>()
  if (addresses.length === 0) return out
  try {
    const rows = await prisma.smartMoneyWallet.findMany({
      where: {
        wallet: { address: { in: addresses } },
        status: { not: null },
      },
      select: {
        status: true,
        wallet: { select: { address: true } },
      },
    })
    for (const r of rows) {
      if (r.wallet?.address && r.status) {
        out.set(r.wallet.address, r.status as WalletStatus)
      }
    }
  } catch {
    // DB failure → all wallets treated as FIRST_SEEN (honest, never throws)
  }
  return out
}

/**
 * Scan candidate tokens for whale-sized buys.
 *
 * Flow:
 *   1. discoverEstablishedGmgnTokens → established token list (age > 24h,
 *      volume ≥ $100k — tokens GMGN has indexed holders for)
 *   2. per token: listGmgnTokenHolders → top holders with PnL
 *   3. per holder: fetchWalletActivity → recent swaps
 *   4. collect all swaps for the token, run detectWhaleBuys
 *   5. classify all buying wallets via SmartMoneyWallet DB
 *
 * Uses established-token discovery instead of the trending feed because
 * GMGN's trending tokens are ultra-fresh pump.fun launches that GMGN
 * hasn't indexed holders for yet (6/10 return 400, 4/10 return empty).
 * The volume-sorted feed surfaces tokens with real holder data.
 *
 * Per-source isolation: one token failure → logged + continue. One
 * wallet failure → logged + continue. Never throws.
 */
export async function scanWhaleBuys(
  opts: WhaleScanOpts = {},
): Promise<WhaleScanResult> {
  const tokenLimit = opts.tokenLimit ?? tokenLimitEnv()
  const holderLimit = opts.holderLimit ?? holderLimitEnv()
  const swapLimit = opts.swapLimit ?? 25
  const config = opts.config

  // 1. Discover established candidate tokens (age > 24h, volume ≥ $100k).
  //    Falls back to trending internally if the volume-sorted endpoint fails.
  let tokens: Array<{ contract: string; chain: string; symbol: string }> = []
  try {
    const discovered = await discoverEstablishedGmgnTokens(Math.min(tokenLimit, 20))
    tokens = discovered
      .filter((t) => t.contract && t.chain === 'solana')
      .slice(0, tokenLimit)
      .map((t) => ({ contract: t.contract, chain: t.chain, symbol: t.symbol }))
  } catch (err) {
    return {
      detections: [],
      aggregated: [],
      errors: [`token-discovery: ${err instanceof Error ? err.message : String(err)}`],
      tokensScanned: 0,
      holdersFetched: 0,
    }
  }

  const errors: string[] = []
  const allDetections: WhaleBuyDetection[] = []
  let holdersFetched = 0

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti]

    // 2. Fetch token holders.
    let holders: GmgnHolderRow[] = []
    try {
      holders = await listGmgnTokenHolders(token.chain, token.contract)
      holdersFetched += holders.length
    } catch (err) {
      errors.push(`holders:${token.contract}: ${err instanceof Error ? err.message.slice(0, 64) : 'err'}`)
      // No holders → no wallets to scan → skip this token
      continue
    }

    if (holders.length === 0) {
      errors.push(`holders:${token.contract}: empty`)
      continue
    }

    // 3. Fetch wallet activity for top holders.
    const topHolders = holders.slice(0, holderLimit)
    const swapsByWallet: Array<{ wallet: string; swaps: NormalizedSwap[] }> = []

    for (let hi = 0; hi < topHolders.length; hi++) {
      const holder = topHolders[hi]
      if (hi > 0) {
        await new Promise<void>((r) => setTimeout(r, WALLET_FETCH_GAP_MS))
      }
      try {
        const activity = await fetchWalletActivity(holder.address, {
          limit: swapLimit,
        })
        swapsByWallet.push({ wallet: holder.address, swaps: activity.swaps })
      } catch (err) {
        errors.push(`activity:${holder.address}: ${err instanceof Error ? err.message.slice(0, 48) : 'err'}`)
      }
    }

    // 4. Collect all swaps for this token and detect whale buys.
    const allSwapsForToken = swapsByWallet.flatMap((w) => w.swaps)

    // Gather all wallet addresses that have swaps for this token.
    const walletAddresses = [...new Set(allSwapsForToken.map((s) => s.walletAddress))]

    // 5. Classify wallets.
    const classifiedWallets = await loadClassifiedWallets(walletAddresses)

    const tokenDetections = detectWhaleBuys({
      contract: token.contract,
      chain: token.chain,
      swaps: allSwapsForToken,
      holders,
      classifiedWallets,
      config,
    })

    allDetections.push(...tokenDetections)
  }

  const aggregated = aggregateWhaleBuyDetections(allDetections)

  return {
    detections: allDetections,
    aggregated,
    errors,
    tokensScanned: tokens.length,
    holdersFetched,
  }
}
