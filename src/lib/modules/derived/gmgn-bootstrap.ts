// ─────────────────────────────────────────────────────────────
// GMGN bootstrap classification (PURE, deterministic, zero I/O).
//
// BRIDGE status labels for wallets harvested from GMGN's leaderboard,
// measured on winrate_30d / pnl_30d / buyVolume30d. GMGN does not report
// the closed-episode count, so the §5 n≥15 / ≥5-token bars CANNOT be
// verified here — this module therefore never claims
// QUALIFIED_SMART_MONEY nor WHALE_AND_SMART_MONEY.
//
// It MAY claim the standalone WHALE status, but ONLY for the single
// measurable whale leg: 30d buy volume ≥ $250k. The other §5 whale legs
// (single position ≥ $50k, portfolio ≥ $250k) need on-chain evidence this
// bridge cannot see.
//
// The label it writes is deliberately weaker than a full wallet-intel
// classification, and the persist layer skips rows that already carry a
// richer classification, so the slow on-chain classifier can always
// overwrite this bootstrap later.
//
// Statuses emitted:
//   WHALE       — buyVolume30d ≥ $250k (§5 30d buy-volume whale leg only;
//                 quality bars + episode count unverified)
//   UNKNOWN     — winRate30d or pnl30d unmeasured (never assume safe)
//   PROVISIONAL — winRate30d ≥ 0.6 AND pnl30d ≥ 0.7, but episode count
//                 unverified
//   WATCHLIST   — measured, but not meeting the §5 quality bars
// ─────────────────────────────────────────────────────────────

import { SMART_MONEY_DEFAULTS, type WalletStatus } from './wallet-intel'

/** One GMGN-measured wallet row, normalized for bootstrap classification. */
export interface GmgnBootstrapRow {
  address: string
  winRate30d: number | null
  pnl30d: number | null
  realizedProfit30d: number | null
  buyVolume30d: number | null
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

/**
 * §5 whale leg this bridge can measure: 30d buy volume ≥ $250k.
 * Reuses the full classifier's threshold (single source of truth).
 */
export const GMGN_BOOTSTRAP_WHALE_BUY_VOLUME_USD =
  SMART_MONEY_DEFAULTS.whaleBuyVolume30dUsd

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
  buyVolume30d?: number | null
  tags?: string[]
}): GmgnBootstrapRow {
  return {
    address: w.address,
    winRate30d: w.winRate30d,
    pnl30d: w.pnl30d,
    realizedProfit30d: w.realizedProfit30d,
    buyVolume30d: w.buyVolume30d ?? null,
    tags: w.tags ?? [],
  }
}

/**
 * Map GMGN-measured stats to a bootstrap status. Pure + deterministic.
 *
 * Priority: the measurable §5 whale leg first — buyVolume30d ≥ $250k →
 * WHALE (the only leg this bridge can verify). Otherwise falls through to
 * the quality-bar mapping. Never emits QUALIFIED_SMART_MONEY or
 * WHALE_AND_SMART_MONEY: the GMGN leaderboard has no episode count, so
 * the §5 n≥15 / ≥5-token bars cannot be verified.
 */
export function gmgnStatusFor(row: GmgnBootstrapRow): GmgnBootstrapVerdict {
  const limitations = [BOOTSTRAP_LIMITATION]

  if (
    row.buyVolume30d !== null &&
    row.buyVolume30d >= GMGN_BOOTSTRAP_WHALE_BUY_VOLUME_USD
  ) {
    return {
      status: 'WHALE',
      confidence: 'medium',
      reasons: [
        `GMGN 30d buy volume $${Math.round(row.buyVolume30d).toLocaleString('en-US')} ≥ $250k whale leg; quality bars unverified`,
      ],
      limitations,
    }
  }

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
