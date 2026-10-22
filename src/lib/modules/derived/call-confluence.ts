// ─────────────────────────────────────────────────────────────
// Call-group confluence — turns "how many independent call groups
// flagged this CA" into a strategy-gate input.
//
// Why: the operator's call-feed (12 Telegram groups, weighted callers)
// already knows which groups called which contract, but that knowledge
// stopped at sniper-scan discovery. Accumulation alerts fired on whale
// buys alone. This module is the join: one contract → group confluence
// facts the evaluators can require or report.
//
// Honesty rules:
//   · A missing/stale feed is `null` confluence, never zero-confidence
//     evidence dressed as a pass. `available: false` says so explicitly.
//   · `sourceCount` counts GROUPS, not messages. A single group spamming
//     a CA 40 times is one group.
//   · weightedScore is passed through as measured (the Python harvester's
//     per-caller weighting); it is never recomputed or scaled here.
// ─────────────────────────────────────────────────────────────

import { loadCallFeed, type CallFeedRead, type CallFeedRow } from './db-call-feed'
import { independentGroupCount } from './call-group-weight'

export interface CallConfluence {
  contract: string
  /** Groups that called this contract (unique, never messages). */
  groups: string[]
  /** Number of distinct groups. */
  groupCount: number
  /** Message mentions across those groups. */
  mentions: number
  /** Harvester-weighted score for this contract (null when unreported). */
  weightedScore: number | null
  /** Signal kinds seen: 'score' | 'whale' | 'shill' | … */
  kinds: string[]
  /** Which of the given trusted groups called it. */
  trustedGroups: string[]
  /**
   * Groups weighted by how often each one ORIGINATES a call rather than
   * re-broadcasting another group's post (measured 2026-10-22: the
   * origin hub `CallAnalyser2` originated 93.1% of its 5,341 contracts
   * while `whaleBuyBotFree` originated 0 of 263 — it can never confirm
   * anything). Counting both as one group lets a pure mirror satisfy a
   * confluence bar on its own. Sum of per-group weights, because a group
   * contributes exactly one vote no matter how many messages it sends.
   */
  effectiveGroupCount: number
  /** False when the feed source could not be read. An empty-but-readable
   * feed is `available: true` — "nobody called it" and "we could not look"
   * have opposite fixes and must never share a label. */
  available: boolean
  /** True when the feed carried an entry for THIS contract. */
  present: boolean
}

export const EMPTY_CONFLUENCE = (contract: string): CallConfluence => ({
  contract,
  groups: [],
  groupCount: 0,
  mentions: 0,
  weightedScore: null,
  kinds: [],
  trustedGroups: [],
  effectiveGroupCount: 0,
  available: false,
  present: false,
})

/**
 * Build a lookup of contract → confluence for the given contracts.
 *
 * One feed read for the whole batch: calling loadCallFeed per contract
 * would hit Postgres once per candidate for no gain.
 */
export async function loadCallConfluence(
  contracts: string[],
  opts: {
    trustedGroups?: readonly string[]
    nowMs?: number
    maxAgeMin?: number
    /**
     * Loader seam. Defaults to the real DB/JSON feed; tests inject a stub so
     * the failure path is exercised without mocking module internals.
     */
    loadFeed?: (nowMs: number, maxAgeMin?: number) => Promise<CallFeedRead>
  } = {},
): Promise<Map<string, CallConfluence>> {
  const out = new Map<string, CallConfluence>()
  for (const c of contracts) out.set(c, EMPTY_CONFLUENCE(c))
  if (contracts.length === 0) return out

  const trusted = new Set(opts.trustedGroups ?? [])
  const loadFeed = opts.loadFeed ?? loadCallFeed
  let read: CallFeedRead = { rows: [], readOk: false }
  try {
    read = await loadFeed(opts.nowMs ?? Date.now(), opts.maxAgeMin)
  } catch {
    return out
  }

  if (!read.readOk) return out
  for (const [contract, entry] of out) out.set(contract, { ...entry, available: true })

  const wanted = new Set(contracts)
  for (const row of read.rows) {
    if (!wanted.has(row.contract)) continue
    const groups = [...new Set(row.sources.filter((s) => typeof s === 'string' && s.length > 0))]
    const weights = row.callerWeights ?? {}
    out.set(row.contract, {
      contract: row.contract,
      groups,
      groupCount: groups.length,
      mentions: row.mentions,
      weightedScore: typeof row.weightedScore === 'number' ? row.weightedScore : null,
      kinds: [...new Set(row.kinds)],
      trustedGroups: groups.filter((g) => trusted.has(g)),
      present: true,
      effectiveGroupCount: independentGroupCount(groups, weights),
      available: true,
    })
  }
  return out
}

/**
 * Does this contract clear the configured confluence bar?
 *
 * `trustedOnly` means only groups named in the trusted list count — an
 * empty trusted list then makes the bar unreachable by construction, which
 * is the safe reading (nobody has been vetted yet, so nobody vouches).
 */
export function clearsConfluence(
  c: CallConfluence | undefined,
  minGroups: number,
  trustedOnly = false,
): { pass: boolean; detail: string } {
  if (!c || !c.available) return { pass: false, detail: 'call-feed unreadable (the feed source threw or could not be read)' }
  if (!c.present) return { pass: false, detail: 'no call group flagged it (feed fresh)' }
  const counted = trustedOnly
    ? c.trustedGroups.length
    : Math.floor(c.effectiveGroupCount + 1e-9)
  const pass = counted >= minGroups
  const label = trustedOnly ? 'trusted group(s)' : 'group(s)'
  return {
    pass,
    detail: `${counted} ${label} called it (bar ${minGroups})` + (pass ? '' : ' — below bar'),
  }
}

/** One readable line for the alert body: who called it, how strongly. */
export function describeConfluence(c: CallConfluence): string {
  if (!c.available) return 'call groups: feed unreadable'
  if (!c.present) return 'call groups: none flagged it'
  if (c.groupCount === 0) return 'call groups: entry present but no group named'
  const score = c.weightedScore === null ? 'score n/a' : `score ${c.weightedScore.toFixed(1)}`
  return `call groups (${c.groupCount}): ${c.groups.slice(0, 4).join(', ')}${c.groups.length > 4 ? '…' : ''} · ${score} · ${c.mentions} mention(s)`
}

export type { CallFeedRow }
