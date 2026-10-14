// ─────────────────────────────────────────────────────────────
// Candidate trust-ranking — collapse copycat mints that share a
// normalized ticker, keeping only the SINGLE most-trusted one.
//
// Operator problem: when a hyped ticker launches (e.g. $PEPE), scammers
// immediately deploy 3-5 copycat mints with the identical ticker. The
// discovery surface lists all of them, the evaluator audits all of them,
// and the bot delivers every copycat that passes the gate — instead of
// the single most-trusted mint.
//
// This module runs AFTER discovery/union/prefilter and BEFORE audit/
// evaluation. At that stage the only trust signal available is what the
// discovery surface itself reported (discoveryEvidence rows + liquidity +
// market cap). It collapses copycats so the pipeline never wastes an
// audit pass or a delivery slot on a less-trusted duplicate ticker.
//
// Pure — zero I/O, no mutation of input.
// ─────────────────────────────────────────────────────────────

import type { SniperEnrichedToken } from '@/lib/modules/derived/sniper-source'

/**
 * Normalize a ticker/symbol for dedup grouping: lowercase, strip leading
 * `$`, strip all non-alphanumeric characters.
 *
 * `$DOGE` / `doge` / `DOGE!` / ` $Doge ` → `doge`.
 *
 * Pure.
 */
export function normalizeTickerForDedup(raw: string | undefined | null): string {
  return (raw ?? '')
    .replace(/^\$+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Count distinct independent audit/discovery sources for a candidate.
 * Falls back to `audited ? 1 : 0` when no discoveryEvidence rows exist.
 * Pure.
 */
function auditConsensus(c: SniperEnrichedToken): number {
  const ev = c.discoveryEvidence
  if (ev && ev.length > 0) {
    return new Set(ev.map((e) => e.provider)).size
  }
  return c.audited ? 1 : 0
}

/** Safe numeric liquidity (0 when null/undefined/non-finite). Pure. */
function safeLiq(c: SniperEnrichedToken): number {
  const v = c.liquidity
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** Safe numeric market cap (0 when null/undefined/non-finite). Pure. */
function safeMc(c: SniperEnrichedToken): number {
  const v = c.marketCap
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** Safe createdAt (treats null/0 as newest = worst for age comparison). Pure. */
function safeAge(c: SniperEnrichedToken): number {
  return typeof c.createdAt === 'number' && c.createdAt > 0 ? c.createdAt : Number.MAX_SAFE_INTEGER
}

/**
 * Trust comparison: returns negative when `a` is MORE trusted (should sort
 * first), positive when `b` is more trusted, 0 when tied.
 *
 * Criteria in priority order:
 *   a) Audit consensus — more distinct discovery/audit sources wins.
 *   b) Verified liquidity — higher USD wins.
 *   c) Age — older token (lower createdAt) wins; verified market cap
 *      breaks sub-ties (higher wins).
 *   d) Contract address — deterministic lexicographic tie-break.
 *
 * Pure.
 */
export function compareByTrust(a: SniperEnrichedToken, b: SniperEnrichedToken): number {
  // a) Audit consensus (higher wins → b.count - a.count so that a with more
  //    sources produces a negative = sorts first).
  const auditDiff = auditConsensus(b) - auditConsensus(a)
  if (auditDiff !== 0) return auditDiff

  // b) Verified liquidity (higher wins → b.liq - a.liq).
  const liqDiff = safeLiq(b) - safeLiq(a)
  if (liqDiff !== 0) return liqDiff

  // c) Age (older wins = lower createdAt sorts first → a.age - b.age).
  const ageDiff = safeAge(a) - safeAge(b)
  if (ageDiff !== 0) return ageDiff

  // c-cont) Verified market cap (higher wins → b.mc - a.mc).
  const mcDiff = safeMc(b) - safeMc(a)
  if (mcDiff !== 0) return mcDiff

  // d) Deterministic tie-break by contract address string comparison.
  const ca = a.contract || ''
  const cb = b.contract || ''
  if (ca < cb) return -1
  if (ca > cb) return 1
  return 0
}

/**
 * Human-readable drop reason referencing the criterion that differentiated
 * the winner from the loser. Pure.
 */
function dropReason(winner: SniperEnrichedToken, loser: SniperEnrichedToken): string {
  const aw = auditConsensus(winner)
  const al = auditConsensus(loser)
  if (aw !== al) {
    return `duplicate-ticker: preferred ${winner.contract} (more audit sources: ${aw} vs ${al})`
  }

  const lw = safeLiq(winner)
  const ll = safeLiq(loser)
  if (lw !== ll) {
    return `duplicate-ticker: preferred ${winner.contract} (higher liquidity $${lw.toLocaleString('en-US')} vs $${ll.toLocaleString('en-US')})`
  }

  const agew = safeAge(winner)
  const agel = safeAge(loser)
  if (agew !== agel) {
    return `duplicate-ticker: preferred ${winner.contract} (older token: createdAt ${agew} vs ${agel})`
  }

  const mw = safeMc(winner)
  const ml = safeMc(loser)
  if (mw !== ml) {
    return `duplicate-ticker: preferred ${winner.contract} (verified market cap $${mw.toLocaleString('en-US')} vs $${ml.toLocaleString('en-US')})`
  }

  return `duplicate-ticker: preferred ${winner.contract} (contract tiebreak: ${winner.contract} vs ${loser.contract})`
}

export interface CollapseResult {
  kept: SniperEnrichedToken[]
  dropped: Array<{ candidate: SniperEnrichedToken; reason: string }>
}

/**
 * Collapse duplicate candidates that share the same normalized ticker,
 * keeping only the SINGLE most-trusted mint per ticker group.
 *
 * - Candidates with unique tickers are kept unchanged.
 * - When >= 2 mints share a normalized ticker, the most-trusted one wins
 *   (see {@link compareByTrust}) and the rest are dropped with a clear
 *   reason.
 * - A blank/empty normalized ticker (e.g. symbol is `$$$` or missing) is
 *   treated as unique-per-contract so nameless tokens are never merged
 *   into one bucket.
 * - Input array is not mutated.
 *
 * Pure.
 */
export function collapseDuplicateCandidatesByTrust(
  candidates: SniperEnrichedToken[],
): CollapseResult {
  const groups = new Map<string, SniperEnrichedToken[]>()

  for (const c of candidates) {
    const norm = normalizeTickerForDedup(c.symbol)
    // A blank ticker means we can't group meaningfully — treat each as
    // unique so nameless tokens are never collapsed together.
    const groupKey = norm.length > 0 ? norm : `__single__:${c.contract || c.id}`
    const bucket = groups.get(groupKey)
    if (bucket) bucket.push(c)
    else groups.set(groupKey, [c])
  }

  const kept: SniperEnrichedToken[] = []
  const dropped: Array<{ candidate: SniperEnrichedToken; reason: string }> = []

  for (const [, bucket] of groups) {
    if (bucket.length === 1) {
      kept.push(bucket[0])
      continue
    }
    // Sort by trust descending (compareByTrust returns negative when a is
    // more trusted, so standard sort puts the best candidate first).
    const sorted = [...bucket].sort(compareByTrust)
    const winner = sorted[0]
    kept.push(winner)
    for (let i = 1; i < sorted.length; i++) {
      dropped.push({ candidate: sorted[i], reason: dropReason(winner, sorted[i]) })
    }
  }

  return { kept, dropped }
}
