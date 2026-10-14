// ─────────────────────────────────────────────────────────────
// Whale verification gate (PURE, deterministic, zero I/O).
//
// Single source of truth for whether a GMGN-measured wallet may enter
// the operator whale list. Every threshold is imported from
// `SMART_MONEY_DEFAULTS` (§5) — never re-declared as a literal here.
//
// A wallet may only pass through one of two legs:
//   WHALE   — 30d buy volume ≥ $250k (§5 whale leg, GMGN-measured)
//   QUALITY — winRate30d ≥ 0.6 AND pnl30d ≥ 0.7 (§5 quality bars)
//
// `wr=0 pnl=0` rows are noise and are explicitly excluded BEFORE the
// whale-volume leg is even considered.
// ─────────────────────────────────────────────────────────────

import { SMART_MONEY_DEFAULTS } from '../derived/wallet-intel'

export interface WhaleVerificationInput {
  winRate30d: number | null
  pnl30d: number | null
  buyVolume30d: number | null
}

export interface WhaleVerification {
  include: boolean
  label: 'WHALE' | 'QUALITY' | 'UNVERIFIED'
  reason: string
}

/**
 * The single GMGN verification gate. Deterministic; pure; thresholds come
 * from `SMART_MONEY_DEFAULTS` so the whale list can never drift from §5.
 */
export function verifyWhaleForList(input: WhaleVerificationInput): WhaleVerification {
  const { winRate30d, pnl30d, buyVolume30d } = input

  if (winRate30d === null || pnl30d === null) {
    return {
      include: false,
      label: 'UNVERIFIED',
      reason: 'GMGN did not measure winrate or pnl',
    }
  }

  if (winRate30d === 0 && pnl30d === 0) {
    return {
      include: false,
      label: 'UNVERIFIED',
      reason: 'winrate=0 and pnl=0 (no measurable quality — excluded)',
    }
  }

  if (buyVolume30d !== null && buyVolume30d >= SMART_MONEY_DEFAULTS.whaleBuyVolume30dUsd) {
    return {
      include: true,
      label: 'WHALE',
      reason: '30d buy volume ≥ $250k whale leg (GMGN-measured)',
    }
  }

  if (
    winRate30d >= SMART_MONEY_DEFAULTS.winRateMin &&
    pnl30d >= SMART_MONEY_DEFAULTS.pnl30dMin
  ) {
    return {
      include: true,
      label: 'QUALITY',
      reason: 'winrate ≥ 60% and pnl ≥ 70% (GMGN-measured)',
    }
  }

  return {
    include: false,
    label: 'UNVERIFIED',
    reason: 'below §5 quality bars',
  }
}
