// ─────────────────────────────────────────────────────────────
// Signal tier — the operator's quality gate (policy A–F).
//
// The evaluator answers "is this token safe + moving?" (SIGNAL /
// WATCHLIST / REJECT). This module answers the different question:
// "is this good enough to send as a TOP signal?"
//
// Tiers (policy D):
//   REJECT          — risk or a core criterion failed
//   UNKNOWN         — essential evidence missing
//   WATCHLIST       — interesting, unconfirmed
//   CANDIDATE       — passed screening, not yet a top signal
//   HIGH_CONVICTION — all mandatory gates passed + independent evidence
//   STALE           — data/signal expired
//
// Only HIGH_CONVICTION may be delivered as a top signal. WATCHLIST may be
// delivered only when the caller explicitly opts in, and must be labelled.
//
// SCOPE: this repo SCREENS. It never executes — execution belongs to
// 1ai-trade-dex. A HIGH_CONVICTION verdict is a published signal, not an
// order; the downstream executor decides and owns the order path.
// Pure — zero I/O.
//
// Formatting/buttons/ID-translation live in sibling modules:
//   signal-formatter.ts · signal-buttons.ts · signal-ids.ts
// ─────────────────────────────────────────────────────────────

import type { SniperDecision } from './meme-sniper'
import type { SmartMoneyEvidence } from './smart-money-provider'

export const SIGNAL_TIERS = [
  'HIGH_CONVICTION',
  'CANDIDATE',
  'WATCHLIST',
  'UNKNOWN',
  'STALE',
  'REJECT',
] as const

export type SignalTier = (typeof SIGNAL_TIERS)[number]

export interface TierInput {
  decision: SniperDecision
  /** Wallet-DB evidence, or null when the provider was unavailable. */
  smartMoney: SmartMoneyEvidence | null
  /** Age of the token in minutes at evaluation time. */
  ageMinutes: number
  /** Max age (minutes) before a signal is considered stale for its stage. */
  staleAfterMinutes: number
  /** Whether the source data was complete (coverage.complete30d etc.). */
  dataComplete: boolean
}

export interface TierResult {
  tier: SignalTier
  /** Why this tier — always populated, for the decision record. */
  reasons: string[]
  /** Missing evidence that would raise the tier. */
  missing: string[]
  /** True only for HIGH_CONVICTION. */
  deliverableAsTopSignal: boolean
  /** True when WATCHLIST/CANDIDATE delivery is explicitly allowed. */
  deliverableAsWatchlist: boolean
}

/** Security gates whose failure is fatal regardless of upside. */
const SECURITY_MARKERS = ['mint', 'freeze', 'honeypot', 'lp', 'sellable'] as const

function isSecurityFailure(reason: string): boolean {
  const r = reason.toLowerCase()
  return SECURITY_MARKERS.some((m) => r.includes(m))
}

/**
 * Classify a decision into a tier.
 *
 * Ordering matters:
 *  1. REJECT beats everything — a security failure is never outranked by
 *     narrative, momentum, or a bullish wallet (policy C).
 *  2. STALE next — an expired signal is not evidence of anything.
 *  3. UNKNOWN when essential evidence is absent.
 *  4. HIGH_CONVICTION requires ALL of: clean screen, fresh data,
 *     independent smart-money confirmation with a real classified wallet.
 *  5. Otherwise CANDIDATE (screening passed) or WATCHLIST.
 */
export function classifySignalTier(input: TierInput): TierResult {
  const { decision, smartMoney, ageMinutes, staleAfterMinutes, dataComplete } = input
  const reasons: string[] = []
  const missing: string[] = []

  // 1. Hard reject — a security failure outranks every bullish signal.
  if (decision.status === 'REJECT') {
    const security = decision.rejections.filter(isSecurityFailure)
    reasons.push(
      security.length > 0
        ? `security failure: ${security[0]}`
        : `core criterion failed: ${decision.rejections[0] ?? 'unspecified'}`,
    )
    return { tier: 'REJECT', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: false }
  }

  // 2. Stale — never send expired data as if it were live.
  if (Number.isFinite(ageMinutes) && ageMinutes > staleAfterMinutes) {
    reasons.push(`signal age ${Math.round(ageMinutes)}m exceeds ${staleAfterMinutes}m freshness window`)
    return { tier: 'STALE', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: false }
  }

  // 3. Missing essential evidence -> never a pass by omission.
  if (!dataComplete) missing.push('source coverage incomplete')
  if (smartMoney === null) missing.push('wallet evidence unavailable')

  // 4. Independent confirmation: a real, fresh, classified buyer.
  const confirmedBuyers = smartMoney?.buyers.length ?? 0
  const hasStrongest = smartMoney?.strongest != null
  const confirmed = confirmedBuyers > 0 && hasStrongest

  if (!confirmed && confirmedBuyers === 0) {
    missing.push(
      smartMoney === null || smartMoney.walletsHolding === 0
        ? 'no classified wallet holds this token'
        : 'classified holders are not bullish or are stale',
    )
  }

  // 5. HIGH_CONVICTION only when nothing essential is missing.
  if (confirmed && missing.length === 0) {
    reasons.push(
      `clean screen at ${decision.metrics.volMcRatio.toFixed(2)}x volume`,
      `${confirmedBuyers} confirmed buyer(s), strongest=${smartMoney?.strongest}`,
    )
    return { tier: 'HIGH_CONVICTION', reasons, missing, deliverableAsTopSignal: true, deliverableAsWatchlist: true }
  }

  // 6. UNKNOWN when the evidence could not be read at all — absence
  // is not safety, and it sorts below "screened but unconfirmed".
  if (smartMoney === null) {
    reasons.push('wallet evidence could not be read — absence is not safety')
    return { tier: 'UNKNOWN', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: false }
  }

  // 7. Screening passed but evidence is incomplete -> CANDIDATE.
  if (decision.status === 'SIGNAL' && missing.length > 0) {
    reasons.push('screening passed but essential evidence is missing')
    return { tier: 'CANDIDATE', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: true }
  }

  reasons.push('interesting but unconfirmed')
  return { tier: 'WATCHLIST', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: true }
}

export interface DeliveryPolicy {
  /** Send HIGH_CONVICTION as a top signal. */
  allowTopSignal: boolean
  /** Send WATCHLIST/CANDIDATE with an explicit non-top label. */
  allowWatchlist: boolean
}

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = {
  allowTopSignal: true,
  allowWatchlist: false, // policy D: watchlist is opt-in, never mixed in
}

/** Should this tier be delivered under the given policy? Pure. */
export function shouldDeliver(tier: SignalTier, policy: DeliveryPolicy = DEFAULT_DELIVERY_POLICY): boolean {
  if (tier === 'HIGH_CONVICTION') return policy.allowTopSignal
  if (tier === 'WATCHLIST' || tier === 'CANDIDATE') return policy.allowWatchlist
  return false // REJECT / UNKNOWN / STALE are never delivered
}

/** Label prefix so a non-top delivery can never be mistaken for one. Pure. */
export function tierLabel(tier: SignalTier): string {
  switch (tier) {
    case 'HIGH_CONVICTION':
      return 'HIGH-CONVICTION'
    case 'CANDIDATE':
      return 'CANDIDATE (not a top signal)'
    case 'WATCHLIST':
      return 'WATCHLIST (not a top signal)'
    case 'UNKNOWN':
      return 'UNKNOWN'
    case 'STALE':
      return 'STALE'
    case 'REJECT':
      return 'REJECT'
  }
}
