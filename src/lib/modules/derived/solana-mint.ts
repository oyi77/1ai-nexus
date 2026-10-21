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

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const B58_INDEX: Record<string, number> = Object.fromEntries(
  [...B58_ALPHABET].map((ch, i) => [ch, i]),
)

/**
 * Decoded byte length of a base58 string, or null when it is not base58.
 * Leading '1' characters are zero bytes, so they are counted separately from
 * the big-integer part.
 */
export function b58DecodeLen(text: string): number | null {
  if (!text) return null
  let start = 0
  while (start < text.length && text[start] === '1') start++
  if (start === text.length) return start
  const limbs = new Array<number>(12).fill(0)
  for (let i = start; i < text.length; i++) {
    const digit = B58_INDEX[text[i]]
    if (digit === undefined) return null
    let carry = digit
    for (let j = 0; j < limbs.length; j++) {
      const next = limbs[j] * 58 + carry
      limbs[j] = next % 4294967296
      carry = (next - limbs[j]) / 4294967296
    }
    if (carry !== 0) return null
  }
  let top = limbs.length - 1
  while (top > 0 && limbs[top] === 0) top--
  const high = limbs[top]
  let bits = top * 32
  let probe = high
  while (probe > 0) {
    bits++
    probe = Math.floor(probe / 2)
  }
  return start + Math.ceil(bits / 8)
}

const SOL_MINT_MIN_BYTES = 29
const SOL_MINT_MAX_BYTES = 31

/**
 * True when a stored Solana contract could be a real mint on its own.
 *
 * Measured 2026-10-22 over 6,518 stored pump contracts: bodies decode to 29,
 * 30 or 31 bytes and nothing in between is empty. The 31-byte rows are two
 * genuine mints (3AFVt63G..., 3AHLPuUk...), so the ceiling sits at 31 — cutting
 * at 30 would drop real tokens. The floor of 29 refuses word-shaped rows that
 * merely end in `pump` (observed: `jonathanpump`, 7 bytes, no trading pair),
 * which the ceiling-only version let through.
 *
 * This mirrors `is_plausible_sol` in scripts/call_feed_contracts.py; the two
 * are cross-checked contract by contract over the whole store, so keep the
 * numbers identical.
 *
 * Byte length cannot prove a row is clean: a 31-byte body is also what the old
 * extractor produced when it welded an escaped ':' onto a real mint. Keeping
 * those honestly un-repaired is the extractor's job.
 */
export function isPlausibleSolMint(contract: string): boolean {
  if (typeof contract !== 'string' || !contract.endsWith('pump')) return false
  const bytes = b58DecodeLen(contract.slice(0, -4))
  return bytes !== null && bytes >= SOL_MINT_MIN_BYTES && bytes <= SOL_MINT_MAX_BYTES
}
