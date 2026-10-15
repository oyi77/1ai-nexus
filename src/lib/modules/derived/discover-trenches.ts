// ─────────────────────────────────────────────────────────────
// Derived — Trenches discovery provider (sniper candidate source).
//
// Feeds the Solpump trenches scanner (anti-rug lifecycle adapter) into the
// sniper discovery composition: a PumpFun bonding curve in the "about to
// graduate" window ([85,100) progress) is an intent signal — the token is
// moments from migrating to an AMM, exactly the lifecycle the operator wants
// pre-staged before the API lists catch up.
//
// Double opt-in (BOTH flags must be the literal "true"):
//   SOLPUMP_TRENCHES_ENABLED — shared fetch flag (see trenches.ts), gates
//     the HTTP call itself (default OFF).
//   SNIPER_TRENCHES_DISCOVERY — sniper-level consumer gate (default OFF).
//   One flag alone can never produce candidates: without the fetch flag the
//     adapter returns [] anyway, and without the sniper gate nothing is fed
//     into discovery. This mirrors the dev-history gate (SNIPER_DEV_HISTORY_
//     GATE, commit 602d11d) — default OFF keeps the pipeline byte-for-byte.
//
// Honest field mapping: the trenches scanner does NOT report price, market
// cap, liquidity, volume or holders. Every such field is 0 (the pipeline's
// UNKNOWN sentinel — prefilterCandidates passes it through and the evaluator
// scores it as unproven), NEVER a fabricated number. Only the identity
// (chain/contract/ticker/name), age, and lifecycle evidence are real.
//
// categoryFor('solpump-trenches', { note }): the note carries "bonding"
// (lifecycle context) + the live progress percentage, so the derived
// category is BONDING (unified-candidate.ts matches note.includes('bonding')
// before its NEW_PAIRS fallback). Graduated-phase rows carry "graduated" and
// would land in POST_MIGRATED — but only sweet-spot rows ([85,100) bonding
// progress) pass the filter, so BONDING is what this provider emits.
//
// Graceful degradation: any failure → empty array + console.warn, never
// throws (one dead discovery surface must not blank the scan).
// ─────────────────────────────────────────────────────────────

import {
  fetchSolpumpTrenches,
  isGraduatingSweetSpot,
  type SolpumpTrenchToken,
} from '@/lib/modules/meme/solpump/trenches'
import { categoryFor } from '@/lib/modules/derived/unified-candidate'
import type { SniperEnrichedToken } from '@/lib/modules/derived/sniper-source'

/**
 * Both opt-in flags must be the literal "true" (double opt-in, default OFF).
 * Exported so the scan pass can log the gate state even when the provider
 * returns [] — a silent off-gate is indistinguishable from a dead scanner.
 */
export function trenchesGateOn(): boolean {
  return (
    process.env.SOLPUMP_TRENCHES_ENABLED === 'true' &&
    process.env.SNIPER_TRENCHES_DISCOVERY === 'true'
  )
}

/**
 * Map one sweet-spot trench row to a sniper candidate. Public for tests;
 * the trenches API does not carry market data, so every market field is the
 * pipeline's UNKNOWN sentinel (0), never fabricated.
 */
export function trenchTokenToCandidate(token: SolpumpTrenchToken): SniperEnrichedToken {
  const progress = token.launchPad?.bondingCurve?.progressPct
  const ageSeconds = token.createdAtAgeSeconds
  const createdAt =
    typeof ageSeconds === 'number' && Number.isFinite(ageSeconds) && ageSeconds >= 0
      ? Date.now() - ageSeconds * 1_000
      : null
  const note = `bonding ${typeof progress === 'number' ? progress : '?'}% sweet-spot`
  return {
    id: `solana:${token.tokenAddress}`,
    platform: 'solpump',
    chain: 'solana',
    contract: token.tokenAddress,
    symbol: token.tokenSymbol,
    name: token.tokenName,
    price: 0,
    change24h: 0,
    volume24h: 0,
    marketCap: 0, // UNKNOWN — trenches API does not report market cap
    liquidity: 0, // UNKNOWN — trenches API does not report liquidity
    createdAt,
    riskLevel: 0,
    holders: 0,
    top10HolderPercent: 0,
    social: {},
    audited: false,
    volume5m: null,
    provenance: {
      sourceType: 'public-api',
      provider: 'solpump',
      note: 'trade.solpump.io trenches scanner (bonding-curve lifecycle)',
    },
    discoveryEvidence: [
      {
        provider: 'solpump-trenches',
        category: categoryFor('solpump-trenches', { note }),
        discoveredAt: Date.now(),
        note,
      },
    ],
    riskKnown: false,
  }
}

/**
 * Sweet-spot trench tokens → sniper discovery candidates.
 *
 * Returns [] when either gate is off (default) or the scanner degrades —
 * never throws, so a dead trenches endpoint cannot blank a scan pass.
 */
export async function discoverTrenches(limit = 8): Promise<SniperEnrichedToken[]> {
  try {
    if (!trenchesGateOn()) return []
    const rows = await fetchSolpumpTrenches('graduating')
    return rows
      .filter((t) => isGraduatingSweetSpot(t))
      .slice(0, limit)
      .map(trenchTokenToCandidate)
  } catch (err) {
    console.warn(
      `[sniper] trenches discovery failed (degraded to empty): ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}
