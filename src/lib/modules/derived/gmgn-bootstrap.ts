// ─────────────────────────────────────────────────────────────
// GMGN bootstrap classification (PURE, deterministic, zero I/O).
//
// BRIDGE status labels for wallets harvested from GMGN's leaderboard,
// measured on winrate_30d / pnl_30d / buyVolume30d. GMGN does not report
// the closed-episode count, so the §5 n≥15 / ≥5-token bars CANNOT be
// verified here — this module therefore never claims
// QUALIFIED_SMART_MONEY nor WHALE_AND_SMART_MONEY.
// It MAY claim the standalone WHALE status, and only for a wallet that
// cleared BOTH axes the pool actually uses: 30d buy volume ≥ $250k (the one
// measurable §5 whale leg) AND the §5 quality bars (winRate ≥ 60%, pnl ≥ 70%).
//
// The volume leg alone is not enough. Live audit 2026-10-23: 274 rows carried
// WHALE through the volume leg with measured PnL between -78% and +48%, none
// of them clearing the quality bars — while `strategy-intake.DEFAULT_CLASSIFIED`
// counts WHALE as a classified buyer. A proven loser therefore inflated every
// signal's confluence. Volume-only wallets are now WATCHLIST, and an unmeasured
// quality axis is UNKNOWN: neither can be quoted as quality.
//
// The label it writes is deliberately weaker than a full wallet-intel
// classification, and the persist layer skips rows that already carry a
// richer classification, so the slow on-chain classifier can always
// overwrite this bootstrap later.
//
// Statuses emitted:
//   WHALE       — buyVolume30d ≥ $250k AND winRate30d ≥ 0.6 AND pnl30d ≥ 0.7
//                 (§5 volume leg + quality bars; episode count unverified)
//   WATCHLIST   — whale-scale volume but measured below the quality bars
//                 (tracked for its buys, never quoted as quality)
//   UNKNOWN     — winRate30d or pnl30d unmeasured (never assume safe)
//   PROVISIONAL — winRate30d ≥ 0.6 AND pnl30d ≥ 0.7, but episode count
//                 unverified
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
 * WHALE needs BOTH axes: the measurable §5 whale leg (buyVolume30d ≥ $250k)
 * AND the quality bars (winRate ≥ 0.6, pnl ≥ 0.7). A volume-only wallet is
 * WATCHLIST — it is tracked for its buys, never quoted as a classified
 * buyer, because `strategy-intake.DEFAULT_CLASSIFIED` counts WHALE as one.
 * An unmeasured quality axis is UNKNOWN, never a pass.
 *
 * Never emits QUALIFIED_SMART_MONEY or WHALE_AND_SMART_MONEY: the GMGN
 * leaderboard has no episode count, so the §5 n≥15 / ≥5-token bars cannot
 * be verified here.
 */
export function gmgnStatusFor(row: GmgnBootstrapRow): GmgnBootstrapVerdict {
  const limitations = [BOOTSTRAP_LIMITATION]
  const volumeLeg =
    row.buyVolume30d !== null &&
    row.buyVolume30d >= GMGN_BOOTSTRAP_WHALE_BUY_VOLUME_USD
  const volumeText =
    row.buyVolume30d === null
      ? 'no 30d buy volume measured'
      : `$${Math.round(row.buyVolume30d).toLocaleString('en-US')} 30d buy volume`

  if (row.winRate30d === null || row.pnl30d === null) {
    return {
      status: 'UNKNOWN',
      confidence: 'low',
      reasons: [
        `GMGN leaderboard did not measure winrate or pnl; ${volumeText}`,
      ],
      limitations,
    }
  }

  const clearsQuality =
    row.winRate30d >= GMGN_BOOTSTRAP_WIN_RATE_MIN &&
    row.pnl30d >= GMGN_BOOTSTRAP_PNL_MIN
  const qualityText =
    `WR ${(row.winRate30d * 100).toFixed(0)}% (bar 60%), ` +
    `PnL ${(row.pnl30d * 100).toFixed(0)}% (bar 70%)`

  if (volumeLeg && clearsQuality) {
    return {
      status: 'WHALE',
      confidence: 'medium',
      reasons: [
        `GMGN ${volumeText} ≥ $250k whale leg AND ${qualityText}; episode count unverified`,
      ],
      limitations,
    }
  }

  if (volumeLeg) {
    return {
      status: 'WATCHLIST',
      confidence: 'low',
      reasons: [
        `GMGN ${volumeText} ≥ $250k whale leg, but ${qualityText} — ` +
          'volume is not performance, so this wallet is not a classified buyer',
      ],
      limitations,
    }
  }

  if (clearsQuality) {
    return {
      status: 'PROVISIONAL',
      confidence: 'medium',
      reasons: [
        `GMGN ${qualityText}; below the $250k volume leg, episode count unverified`,
      ],
      limitations,
    }
  }

  return {
    status: 'WATCHLIST',
    confidence: 'low',
    reasons: [`GMGN ${qualityText} — below §5 quality bars`],
    limitations,
  }
}
