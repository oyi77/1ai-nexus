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

/** One explainable component of the composite score (Meme Alpha Terminal spec). */
export interface ScoreReason {
  /** Signed contribution to the composite score. */
  points: number
  /** Machine-readable reason code, e.g. `VOLUME_ACCELERATION`. */
  code: string
  /** Human-readable explanation. */
  label: string
}

/**
 * Explainable composite score — same total as `scoreOf`, plus the
 * per-component breakdown (volume / market-cap / momentum) with reason
 * codes. Uses the same formula so `scoreOf` stays the single source of
 * truth; `explainScore` only decomposes it.
 */
export function explainScore(t: MemeAlphaToken): { score: number; reasons: ScoreReason[] } {
  const volume = (t.volume24h ?? 0) / 1e6
  const marketCap = (t.marketCap ?? 0) / 1e9
  const momentum = t.change24h ?? 0
  const score = volume + marketCap + momentum
  const reasons: ScoreReason[] = []
  if (volume > 0) reasons.push({ points: volume, code: 'VOLUME_ACTIVITY', label: `Volume ${(t.volume24h ?? 0).toLocaleString()} USD` })
  if (marketCap > 0) reasons.push({ points: marketCap, code: 'MARKET_CAP', label: `Market cap ${(t.marketCap ?? 0).toLocaleString()} USD` })
  if (momentum > 0) reasons.push({ points: momentum, code: 'MOMENTUM', label: `24h momentum +${Math.round(momentum * 100)}%` })
  if (momentum < 0) reasons.push({ points: momentum, code: 'MOMENTUM_REVERSAL', label: `24h momentum ${Math.round(momentum * 100)}%` })
  if (reasons.length === 0) reasons.push({ points: 0, code: 'NO_DATA', label: 'No volume / market cap / momentum data' })
  return { score, reasons }
}

/**
 * Dedup tokens by chain:contract (platform-scoped id). Keeps the first
 * occurrence (highest-ranked since input is pre-sorted by score).
 */
function dedup(tokens: MemeAlphaToken[]): MemeAlphaToken[] {
  const seen = new Set<string>()
  return tokens.filter((t) => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
}

export function sortByMetrics(tokens: MemeAlphaToken[]): MemeAlphaToken[] {
  return dedup([...tokens].sort((a, b) => scoreOf(b) - scoreOf(a)))
}
