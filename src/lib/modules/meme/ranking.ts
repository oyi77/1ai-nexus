// ─────────────────────────────────────────────────────────────
// Pure meme-alpha ranking helper.
// No network / DB / Next dependencies — safe to import from the
// leaderboard route and from unit tests. Mirrors the shared
// MemeAlphaToken shape.
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken } from './types'

/**
 * Rank discovery tokens by a composite of volume + market cap + momentum
 * (descending). Higher = more interesting. Missing fields default to 0.
 * Returns a new array (does not mutate the input).
 */
// Exact composite scoring formula (kept here as the single source of truth).
// NOTE: `change24h` is intentionally UN-scaled — for typical meme tokens a
// 30% move (30) dwarfs volume24h (1e6 -> 1) and marketCap (1e9 -> 1) by
// ~1-3 orders of magnitude, so momentum dominates the ranking.
export function scoreOf(t: MemeAlphaToken): number {
  return (t.volume24h ?? 0) / 1e6 + (t.marketCap ?? 0) / 1e9 + (t.change24h ?? 0)
}

export function sortByMetrics(tokens: MemeAlphaToken[]): MemeAlphaToken[] {
  return [...tokens].sort((a, b) => scoreOf(b) - scoreOf(a))
}
