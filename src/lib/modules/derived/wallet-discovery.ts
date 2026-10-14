// ─────────────────────────────────────────────────────────────
// Wallet → candidate discovery (Phase 4 of the operator pipeline).
//
// Direction reversal: the pipeline already enriches a KNOWN token with
// wallet evidence (wallet-tracer). This module does the opposite — a
// tracked wallet's fresh BUY becomes a new candidate that enters the
// discovery funnel even before any API list ranks it.
//
// Discipline:
//   - A buy is SOL→token with a COMPLETE leg carrying HISTORICAL USD.
//     Partial legs and current-price legs cannot prove the size, so they
//     are excluded — never summed as if real (same rule as whale-evidence).
//   - A transfer / airdrop / LP move has no paired side; parseSolanaTransaction
//     already rejects those. Nothing here re-admits them.
//   - "Meaningful accumulation" is measured on USD and requires the leg to
//     carry historical USD; a $0 or unknown-size buy is not a signal.
//   - Token symbols/names come only from evidence present in the swap; a
//     missing symbol stays '' (the enricher fills it from a market API).
// Pure — zero I/O, no network, no DB.
// ─────────────────────────────────────────────────────────────

import type { NormalizedSwap } from './solana-harvest'
import type { CandidateEvidence } from './unified-candidate'

/** Wrapped SOL mint — the buy side of a Solana spot swap. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112'

export interface WalletBuyCandidate {
  contract: string
  chain: 'solana'
  /** First wallet to buy this mint inside the window. */
  discoveredBy: string
  /** All tracked wallets that bought it — accumulation breadth. */
  buyers: string[]
  /** Sum of complete, historically-priced buy legs (USD). */
  buyVolumeUsd: number
  buyCount: number
  /** Earliest buy timestamp (ms). */
  firstBuyAt: number
  /** Latest buy timestamp (ms). */
  lastBuyAt: number
  discoveryEvidence: CandidateEvidence[]
}

export interface WalletDiscoveryOptions {
  /** Only buys at/after this epoch ms. */
  sinceMs?: number
  /** Minimum accumulated USD across buyers to be worth a candidate. */
  minBuyUsd?: number
  now?: number
}

/**
 * Is this normalized swap a complete, historically-priced BUY of a token?
 * Reasons a swap fails are deliberate and specific — never a bare false:
 *  - not a SOL→token leg (a sell, or a token→token swap)
 *  - rejected/partial completeness (size unproven)
 *  - no historical USD (a current-price leg is not the cost basis)
 *  - the mint equals SOL itself (a wrapped-SOL round trip, not a token buy)
 */
export function classifyBuy(
  s: NormalizedSwap,
  walletAddress: string,
): { ok: true; amountUsd: number } | { ok: false; reason: string } {
  // A non-swap must report WHY it is not a swap; a generic completeness
  // label would hide that the parser already rejected it upstream.
  if (s.rejectReason) return { ok: false, reason: s.rejectReason }
  if (s.completeness !== 'complete') return { ok: false, reason: `completeness=${s.completeness}` }
  if (s.inputMint !== SOL_MINT) return { ok: false, reason: 'not-sol-leg' }
  if (!s.outputMint || s.outputMint === SOL_MINT) return { ok: false, reason: 'sol-to-sol-or-empty' }
  if (s.limitations.includes('stalePrice-current-only') || s.limitations.includes('historical-usd-unavailable')) {
    return { ok: false, reason: 'current-price-not-historical' }
  }
  if (s.inputUsd === null) return { ok: false, reason: 'missing-historical-usd' }
  if (s.walletAddress !== walletAddress) return { ok: false, reason: 'wallet-mismatch' }
  return { ok: true, amountUsd: s.inputUsd }
}

/**
 * Fold a set of (wallet, swaps) harvests into discovery candidates.
 * One mint bought by three wallets is ONE candidate with three buyers —
 * accumulation breadth is evidence, not three separate rows.
 */
export function foldWalletBuys(
  perWallet: Array<{ wallet: string; swaps: NormalizedSwap[] }>,
  opts: WalletDiscoveryOptions = {},
): WalletBuyCandidate[] {
  const now = opts.now ?? Date.now()
  const since = opts.sinceMs ?? now - 60 * 60_000 // last hour by default
  const minUsd = opts.minBuyUsd ?? (Number(process.env.WALLET_DISCOVERY_MIN_USD) || 2_000)
  const byMint = new Map<string, WalletBuyCandidate>()
  // Swap identity across the whole fold — one wallet re-buying the same mint
  // in a NEW signature is a rea second buy andl must count.
  const seenSwaps = new Set<string>()
  for (const { wallet, swaps } of perWallet) {
    for (const s of swaps) {
      if (s.timestamp === null || s.timestamp < since || s.timestamp > now) continue
      const buy = classifyBuy(s, wallet)
      if (!buy.ok) continue // rejected transfers/partials never become candidates
      // Idempotent per (wallet, signature): a re-harvested swap must not
      // double-count USD or inflate buyCount — including the FIRST sighting,
      // which would otherwise create the candidate before the check runs.
      const key = `${wallet}|${s.transactionSignature}`
      if (seenSwaps.has(key)) continue
      seenSwaps.add(key)
      const k = s.outputMint
      const hit = byMint.get(k)
      if (!hit) {
        byMint.set(k, {
          contract: k,
          chain: 'solana',
          discoveredBy: wallet,
          buyers: [wallet],
          buyVolumeUsd: buy.amountUsd,
          buyCount: 1,
          firstBuyAt: s.timestamp,
          lastBuyAt: s.timestamp,
          discoveryEvidence: [],
        })
        continue
      }
      hit.buyVolumeUsd += buy.amountUsd
      hit.buyCount += 1
      if (!hit.buyers.includes(wallet)) hit.buyers.push(wallet)
      hit.firstBuyAt = Math.min(hit.firstBuyAt, s.timestamp)
      hit.lastBuyAt = Math.max(hit.lastBuyAt, s.timestamp)
    }
  }

  const out: WalletBuyCandidate[] = []
  for (const c of byMint.values()) {
    if (c.buyVolumeUsd < minUsd) continue
    c.discoveryEvidence = c.buyers.map((w) => ({
      provider: 'wallet-trace',
      category: 'WHALE_ACTIVITY' as const,
      discoveredAt: c.lastBuyAt,
      note: `buyer ${w} | $${Math.round(c.buyVolumeUsd).toLocaleString()} across ${c.buyCount} buy legs`,
    }))
    out.push(c)
  }
  // Strongest accumulation first — the operator reads the head first.
  return out.sort((a, b) => b.buyVolumeUsd - a.buyVolumeUsd)
}

/**
 * Breadth classification used in the digest: how many distinct tracked
 * wallets accumulated. One wallet = single-buyer; 2+ = coordinated.
 */
export function accumulationLabel(c: WalletBuyCandidate): string {
  if (c.buyers.length >= 3) return `akumulasi terkoordinasi (${c.buyers.length} wallet)`
  if (c.buyers.length === 2) return `dua wallet membeli (${c.buyers.length})`
  return `satu wallet membeli`
}
