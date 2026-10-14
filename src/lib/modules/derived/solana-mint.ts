// ─────────────────────────────────────────────────────────────
// Solana mint normalization — pure, zero I/O.
//
// Upstream bug (observed live 2026-10-14 on GMGN
// /vas/api/v1/wallet_activity/sol): some SOL→token buy rows report the
// wrapped-SOL quote leg as a MALFORMED mint, exactly:
//
//   So11111111111111111111111111111111111111111
//
// i.e. the canonical wrapped-SOL mint
//   So11111111111111111111111111111111111111112
// with the FINAL character `2` replaced by `1` (single-character
// substitution at index 42, not a truncation — both strings are 43 chars).
// The live rows carry the malformed string in BOTH `quote_token.token_address`
// and `quote_address` (with `quote_token.symbol` = "SOL"), so there is no
// true mint elsewhere in the same row to prefer; the only possible recovery
// is mapping THIS EXACT near-miss to the canonical mint.
//
// Solana mints are base58 strings of 32-44 chars; `So` + forty `1`s + final
// `1` is not a real token and is not a plausible independent mint — it is
// unambiguously the canonical SOL mint with a corrupted final char. We map
// ONLY that exact string. We never generalize to "43 chars ending in 11111"
// or "starts with So", because those predicates are not uniquely SOL.
// ─────────────────────────────────────────────────────────────

import { SOL_MINT } from './solana-harvest'

/** The exact malformed wrapped-SOL mint observed in the live GMGN feed. */
export const MALFORMED_SOL_MINT = 'So11111111111111111111111111111111111111111'

/**
 * True only for the canonical wrapped-SOL mint (`So` + forty `1`s + `2`,
 * 43 chars). The malformed near-miss is NOT considered wrapped SOL by this
 * predicate, so gate code that must not accept corrupted mints stays exact.
 */
export function isWrappedSolMint(mint: string): boolean {
  return mint === SOL_MINT
}

/**
 * Map the canonical SOL mint to itself (idempotent) and the exact observed
 * GMGN near-miss to the canonical mint. Every other input — including any
 * other 43-char base58 string — is returned unchanged. This never remaps
 * arbitrary strings, so it cannot fabricate a SOL leg for a real token.
 */
export function normalizeSolMint(mint: string): string {
  if (mint === SOL_MINT) return SOL_MINT
  if (mint === MALFORMED_SOL_MINT) return SOL_MINT
  return mint
}
