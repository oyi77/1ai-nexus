// ─────────────────────────────────────────────────────────────
// Whale-buy detector — PURE, zero I/O.
//
// Token-first detection: given a token's recent wallet-activity swaps
// (BUY legs with real USD) and its current holder set, identify
// whale-sized buys. A whale buy is a BUY leg (SOL → token) whose
// inputUsd >= minUsd — never a static holding, never an invented USD.
//
// Scoring:
//   · walletClass = the wallet's SmartMoneyWallet status when known
//     (QUALIFIED_SMART_MONEY | WHALE | WHALE_AND_SMART_MONEY | …),
//     or 'FIRST_SEEN' when the wallet is NOT in the classified DB.
//   · isFirstSeen = true when the wallet has never been classified.
//
// Holders enrich each detection with `isCurrentHolder` (is the buyer a
// current top holder of this token?) — context, never a gate. A holder
// with no matching BUY leg produces NO detection.
//
// Mirrors wallet-intel.ts / smart-money-confluence.ts: pure, every
// threshold is a parameter, zero I/O, fixture-testable.
// ─────────────────────────────────────────────────────────────

import { SOL_MINT, type NormalizedSwap } from '@/lib/modules/derived/solana-harvest'
import type { GmgnHolderRow } from '@/lib/modules/meme/gmgn'
import type { WalletStatus } from '@/lib/modules/derived/wallet-intel'

/** A single whale-sized buy detection for one wallet on one token. */
export interface WhaleBuyDetection {
  contract: string
  chain: string
  /** The wallet that made the buy. */
  wallet: string
  /** Real USD value of the buy leg — from trade-time cost_usd, never estimated. */
  usdValue: number
  /** Trade timestamp (ms epoch); null when the swap row had no timestamp. */
  boughtAt: number | null
  /** Classified status from SmartMoneyWallet DB, or 'FIRST_SEEN' when unclassified. */
  walletClass: WalletStatus | 'FIRST_SEEN'
  /** True when the wallet is NOT in the SmartMoneyWallet DB (never classified). */
  isFirstSeen: boolean
  /** True when the buying wallet is also a current top holder of the token. */
  isCurrentHolder: boolean
}

/** Every threshold, as a concrete contract (no hidden constants). */
export interface WhaleBuyDetectorConfig {
  /** Minimum USD for a buy to qualify as whale-sized. Default $10k. */
  minUsd: number
}

export const WHALE_BUY_DEFAULTS: WhaleBuyDetectorConfig = {
  minUsd: 10_000,
};

/** Every status that means "this wallet has been classified" (any label). */
const CLASSIFIED_STATUSES: Record<WalletStatus, true> = {
  QUALIFIED_SMART_MONEY: true,
  WHALE: true,
  WHALE_AND_SMART_MONEY: true,
  WATCHLIST: true,
  PROVISIONAL: true,
  DISQUALIFIED: true,
  UNKNOWN: true,
};

function cfgOf(c?: Partial<WhaleBuyDetectorConfig>): WhaleBuyDetectorConfig {
  return { ...WHALE_BUY_DEFAULTS, ...(c ?? {}) };
}

/**
 * Pure detector. Scans swap activity for BUY legs of the given token
 * whose USD value meets the whale threshold.
 *
 * Deduplicates by wallet (keeps the largest buy when a wallet has
 * multiple qualifying buys of the same token). Returns detections
 * sorted by USD value descending.
 *
 * NEVER fabricates: a swap with null inputUsd is skipped; a swap with
 * inputUsd < minUsd is skipped; a rejected/partial swap is skipped.
 * Holders without a matching BUY leg produce NO detection.
 */
export function detectWhaleBuys(input: {
  contract: string
  chain: string
  swaps: NormalizedSwap[]
  holders: GmgnHolderRow[]
  classifiedWallets: Map<string, WalletStatus>
  config?: Partial<WhaleBuyDetectorConfig>
}): WhaleBuyDetection[] {
  const cfg = cfgOf(input.config);
  const contract = input.contract;
  const chain = input.chain;

  // Holder addresses — used to mark `isCurrentHolder` on a detection.
  const holderSet = new Set(
    input.holders
      .map((h) => h.address)
      .filter((a) => typeof a === 'string' && a.length > 0),
  );

  // Deduplicate by wallet: keep the largest USD buy per wallet.
  const byWallet = new Map<string, WhaleBuyDetection>();

  for (const s of input.swaps) {
    // Must be a BUY leg: SOL → the token we are scanning.
    if (s.completeness !== 'complete') continue;
    if (s.outputMint !== contract) continue;
    if (s.inputMint !== SOL_MINT) continue;
    if (s.inputUsd === null) continue; // never invent USD
    if (!Number.isFinite(s.inputUsd) || s.inputUsd <= 0) continue;
    if (s.inputUsd < cfg.minUsd) continue; // below whale threshold

    const wallet = s.walletAddress;
    if (!wallet) continue;

    const existing = byWallet.get(wallet);
    if (existing && existing.usdValue >= s.inputUsd) continue; // keep larger

    const status = input.classifiedWallets.get(wallet);
    const isClassified = status !== undefined && CLASSIFIED_STATUSES[status] === true;
    const walletClass: WalletStatus | 'FIRST_SEEN' = isClassified
      ? (status as WalletStatus)
      : 'FIRST_SEEN';

    byWallet.set(wallet, {
      contract,
      chain,
      wallet,
      usdValue: s.inputUsd,
      boughtAt: s.timestamp,
      walletClass,
      isFirstSeen: !isClassified,
      isCurrentHolder: holderSet.has(wallet),
    });
  }

  // Sort by USD descending — largest whale buys first.
  return [...byWallet.values()].sort((a, b) => b.usdValue - a.usdValue);
}

/**
 * Aggregate detections into per-contract rows for the store. Pure.
 * Each contract becomes one row with buyers[], total volume, count,
 * and first/last buy timestamps.
 */
export function aggregateWhaleBuyDetections(
  detections: WhaleBuyDetection[],
): Array<{
  contract: string
  chain: string
  buyers: string[]
  buyVolumeUsd: number
  buyCount: number
  firstBuyAt: number | null
  lastBuyAt: number | null
}> {
  const byContract = new Map<
    string,
    {
      contract: string
      chain: string
      buyers: string[]
      buyVolumeUsd: number
      buyCount: number
      firstBuyAt: number | null
      lastBuyAt: number | null
    }
  >();

  for (const d of detections) {
    const existing = byContract.get(d.contract);
    if (existing) {
      if (!existing.buyers.includes(d.wallet)) existing.buyers.push(d.wallet);
      existing.buyVolumeUsd += d.usdValue;
      existing.buyCount += 1;
      if (d.boughtAt !== null) {
        if (existing.firstBuyAt === null || d.boughtAt < existing.firstBuyAt) {
          existing.firstBuyAt = d.boughtAt;
        }
        if (existing.lastBuyAt === null || d.boughtAt > existing.lastBuyAt) {
          existing.lastBuyAt = d.boughtAt;
        }
      }
    } else {
      byContract.set(d.contract, {
        contract: d.contract,
        chain: d.chain,
        buyers: [d.wallet],
        buyVolumeUsd: d.usdValue,
        buyCount: 1,
        firstBuyAt: d.boughtAt,
        lastBuyAt: d.boughtAt,
      });
    }
  }

  return [...byContract.values()];
}
