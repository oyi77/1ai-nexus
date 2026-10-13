// ─────────────────────────────────────────────────────────────
// GMGN bootstrap classification (PURE, deterministic, zero I/O).
//
// BRIDGE status labels for wallets harvested from GMGN's leaderboard,
// measured on winrate_30d / pnl_30d only. GMGN does not report the
// closed-episode count, so the §5 n≥15 / ≥5-token bars CANNOT be
// verified here — this module therefore never claims
// QUALIFIED_SMART_MONEY (nor WHALE, which also needs on-chain evidence).
//
// The label it writes is deliberately weaker than a full wallet-intel
// classification, and the persist layer skips rows that already carry a
// richer classification, so the slow on-chain classifier can always
// overwrite this bootstrap later.
//
// Statuses emitted:
//   UNKNOWN     — winRate30d or pnl30d unmeasured (never assume safe)
//   PROVISIONAL — winRate30d ≥ 0.6 AND pnl30d ≥ 0.7, but episode count
//                 unverified
//   WATCHLIST   — measured, but not meeting the §5 quality bars
// ─────────────────────────────────────────────────────────────

import type { WalletStatus } from './wallet-intel'

/** One GMGN-measured wallet row, normalized for bootstrap classification. */
export interface GmgnBootstrapRow {
  address: string
  winRate30d: number | null
  pnl30d: number | null
  realizedProfit30d: number | null
  tags: string[]
}

/** Bootstrap verdict, with the classifier's confidence/reasons/limitations. */
export interface GmgnBootstrapVerdict {
  status: WalletStatus
  confidence: 'medium' | 'low'
  reasons: string[]
  limitations: string[]
}

/** §5 quality bars shared with the full classifier (same thresholds). */
export const GMGN_BOOTSTRAP_PNL_MIN = 0.7
export const GMGN_BOOTSTRAP_WIN_RATE_MIN = 0.6

const BOOTSTRAP_LIMITATION =
  'GMGN bootstrap — full wallet-intel classifier may overwrite'

/**
 * Normalize a GMGN leaderboard/harvester row into the bootstrap shape.
 * Pure + deterministic; tags default to [] so harvested rows (which carry
 * no tags) can pass straight through.
 */
export function gmgnBootstrapInput(w: {
  address: string
  winRate30d: number | null
  pnl30d: number | null
  realizedProfit30d: number | null
  tags?: string[]
}): GmgnBootstrapRow {
  return {
    address: w.address,
    winRate30d: w.winRate30d,
    pnl30d: w.pnl30d,
    realizedProfit30d: w.realizedProfit30d,
    tags: w.tags ?? [],
  }
}

/**
 * Map GMGN-measured stats to a bootstrap status. Pure + deterministic.
 *
 * Never emits QUALIFIED_SMART_MONEY / WHALE / WHALE_AND_SMART_MONEY:
 * the GMGN leaderboard has no episode count, so the §5 n≥15 / ≥5-token
 * bars cannot be verified.
 */
export function gmgnStatusFor(row: GmgnBootstrapRow): GmgnBootstrapVerdict {
  const limitations = [BOOTSTRAP_LIMITATION]

  if (row.winRate30d === null || row.pnl30d === null) {
    return {
      status: 'UNKNOWN',
      confidence: 'low',
      reasons: ['GMGN leaderboard did not measure winrate or pnl'],
      limitations,
    }
  }

  if (
    row.winRate30d >= GMGN_BOOTSTRAP_WIN_RATE_MIN &&
    row.pnl30d >= GMGN_BOOTSTRAP_PNL_MIN
  ) {
    return {
      status: 'PROVISIONAL',
      confidence: 'medium',
      reasons: ['GMGN leaderboard winrate/pnl; episode count unverified'],
      limitations,
    }
  }

  return {
    status: 'WATCHLIST',
    confidence: 'low',
    reasons: ['GMGN-measured winrate/pnl below §5 quality bars'],
    limitations,
  }
}
