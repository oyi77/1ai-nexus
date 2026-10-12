// ─────────────────────────────────────────────────────────────
// Meme Sniper — accumulation phase (TAHAP 2).
//
// The audit trail already records one entry per evaluation per contract,
// but only the KEY MOMENTUM facts (market cap, liquidity). Holder
// distribution was read, gated, and thrown away — so the pipeline could
// never answer the two questions that separate a real accumulation from a
// dead cat: is supply moving OFF the risky tiers, and is it being bought
// quietly (volume without a price move)?
//
// This module is PURE. It takes the holder/momentum readings of the same
// contract across successive scans (oldest first) and returns a phase
// score with named evidence. No I/O, no clock, no DB — the caller supplies
// the readings, so every rule below is unit-testable.
//
// Discipline inherited from the evaluator: UNKNOWN is never a PASS and
// never a zero. A missing holder reading contributes NO delta — it cannot
// be read as supply leaving. Phase is UNKNOWN until there are two real
// readings, because one reading has no direction.
// ─────────────────────────────────────────────────────────────

/** The subset of a scan reading this module reasons over. */
export interface AccumulationReading {
  /** ISO timestamp of the reading. */
  at: string
  /** Percent of supply held by the deployer. null = unproven. */
  devPercent: number | null
  /** Percent bought in the launch block/seconds. null = unproven. */
  sniperPercent: number | null
  /** Percent held by same-block bundler wallets. null = unproven. */
  bundlerPercent: number | null
  /** Percent held by insiders. null = unproven. */
  insiderPercent: number | null
  /** Combined top-10 holder share. null = unproven. */
  top10Percent: number | null
  /** Largest linked-wallet cluster share. null = unproven. */
  clusterPercent: number | null
  marketCapUsd: number | null
  liquidityUsd: number | null
  volume5mUsd: number | null
}

export type PhaseVerdict = 'ACCUMULATION' | 'DISTRIBUTION' | 'CHURN' | 'UNKNOWN'

/** The four supply tiers whose delta carries the signal. */
export const RISK_TIERS = ['dev', 'sniper', 'bundler', 'insider'] as const
export type RiskTier = (typeof RISK_TIERS)[number]

export interface TierDelta {
  tier: RiskTier
  from: number | null
  to: number | null
  /** to - from; null when either reading is missing. */
  delta: number | null
}

export interface AccumulationPhase {
  verdict: PhaseVerdict
  /** 0..100. Higher = supply leaving risky hands on quiet volume. */
  score: number
  /** Readings used, oldest first. */
  readings: number
  deltas: TierDelta[]
  /** Named facts behind the verdict — one line each, operator-readable. */
  evidence: string[]
  /** Why the verdict is UNKNOWN, when it is. */
  reason?: string
}

export interface AccumulationConfig {
  /** Market-cap move beyond which the tape is no longer "quiet". */
  quietPriceMovePct: number
  /** Volume/mcap ratio at or above which real flow is present. */
  hotVolMcRatio: number
  /** A risky tier must shed at least this many points to count as leaving. */
  minTierExitPct: number
}

export const ACCUMULATION_DEFAULTS: AccumulationConfig = {
  quietPriceMovePct: 0.1, // ±10% — above this it is a move, not stealth
  hotVolMcRatio: 0.5, // measured market ratio band for live young pairs
  minTierExitPct: 0.5, // 0.5 points of supply is a real transfer, not noise
}

/** Signed change, or null when either side is unproven. */
function delta(from: number | null, to: number | null): number | null {
  return from === null || to === null ? null : to - from
}

function pct(v: number | null): string {
  return v === null ? 'n/a' : `${Math.round(v * 10) / 10}%`
}

/**
 * Classify the accumulation phase of one contract from its reading history.
 *
 * `readings` MUST be oldest-first. Fewer than two readings with at least one
 * delta is UNKNOWN — a single snapshot has no direction, and this module
 * never guesses one.
 */
export function classifyAccumulation(
  readings: AccumulationReading[],
  config: AccumulationConfig = ACCUMULATION_DEFAULTS,
): AccumulationPhase {
  const empty: AccumulationPhase = {
    verdict: 'UNKNOWN',
    score: 0,
    readings: readings.length,
    deltas: [],
    evidence: [],
  }

  if (readings.length < 2) {
    return { ...empty, reason: 'need at least 2 readings; 1 has no direction' }
  }

  const first = readings[0]
  const last = readings[readings.length - 1]

  const deltas: TierDelta[] = RISK_TIERS.map((tier) => {
    const key = `${tier}Percent` as const
    return { tier, from: first[key], to: last[key], delta: delta(first[key], last[key]) }
  })

  const known = deltas.filter((d) => d.delta !== null)
  if (known.length === 0) {
    return { ...empty, deltas, reason: 'no tier has two proven readings — delta unprovable' }
  }

  const evidence: string[] = []

  // ── Supply leaving the risky tiers ──────────────────────────
  // Only tiers with a PROVEN delta can be credited. A tier that is
  // unproven on either side is reported, never counted as an exit.
  let exited = 0
  for (const d of deltas) {
    if (d.delta === null) {
      evidence.push(`${d.tier}: delta unproven (${pct(d.from)} → ${pct(d.to)})`)
    } else if (d.delta <= -config.minTierExitPct) {
      exited++
      evidence.push(`${d.tier}: supply leaving ${pct(d.from)} → ${pct(d.to)}`)
    } else if (d.delta >= config.minTierExitPct) {
      evidence.push(`${d.tier}: supply entering ${pct(d.from)} → ${pct(d.to)}`)
    }
  }

  const top10Delta = delta(first.top10Percent, last.top10Percent)
  const clusterDelta = delta(first.clusterPercent, last.clusterPercent)
  const concentrationFalling =
    top10Delta !== null && top10Delta <= -config.minTierExitPct ? true : top10Delta !== null && top10Delta > config.minTierExitPct ? false : null
  if (top10Delta !== null) {
    evidence.push(
      `top10: ${top10Delta <= -config.minTierExitPct ? 'concentration falling' : top10Delta >= config.minTierExitPct ? 'concentration rising' : 'flat'} ${pct(first.top10Percent)} → ${pct(last.top10Percent)}`,
    )
  }
  if (clusterDelta !== null) {
    evidence.push(
      `cluster: ${clusterDelta <= -config.minTierExitPct ? 'unwinding' : clusterDelta >= config.minTierExitPct ? 'growing' : 'flat'} ${pct(first.clusterPercent)} → ${pct(last.clusterPercent)}`,
    )
  }

  // ── Quiet: is price still flat while flow is real? ──────────
  const mcDelta =
    first.marketCapUsd !== null && last.marketCapUsd !== null && first.marketCapUsd > 0
      ? (last.marketCapUsd - first.marketCapUsd) / first.marketCapUsd
      : null
  const liquidityDelta =
    first.liquidityUsd !== null && last.liquidityUsd !== null && first.liquidityUsd > 0
      ? (last.liquidityUsd - first.liquidityUsd) / first.liquidityUsd
      : null

  const quiet = mcDelta !== null && Math.abs(mcDelta) <= config.quietPriceMovePct
  if (mcDelta !== null) {
    evidence.push(
      quiet
        ? `price quiet: mcap ${(mcDelta * 100).toFixed(1)}% (within ±${config.quietPriceMovePct * 100}%)`
        : `price moved: mcap ${(mcDelta * 100).toFixed(1)}% — beyond quiet band`,
    )
  }
  if (liquidityDelta !== null && liquidityDelta < -0.2) {
    evidence.push(`liquidity draining ${(liquidityDelta * 100).toFixed(1)}% — exit capacity shrinking`)
  }

  const volMc =
    last.volume5mUsd !== null && last.marketCapUsd !== null && last.marketCapUsd > 0
      ? last.volume5mUsd / last.marketCapUsd
      : null
  const hot = volMc !== null && volMc >= config.hotVolMcRatio
  if (volMc !== null) {
    evidence.push(`flow: vol/mcap ${volMc.toFixed(2)}x — ${hot ? 'real flow present' : 'below the measured hot band'}`)
  }

  // ── Verdict ─────────────────────────────────────────────────
  // Accumulation requires BOTH: supply leaving risky hands AND real flow.
  // Flow alone with rising concentration is churn — someone is buying while
  // someone else is still holding the bag; that is not accumulation.
  const supplyLeaving = exited > 0 && concentrationFalling !== false
  const supplyEntering =
    deltas.some((d) => d.delta !== null && d.delta >= config.minTierExitPct) ||
    concentrationFalling === false

  let verdict: PhaseVerdict
  if (supplyLeaving && hot) verdict = 'ACCUMULATION'
  else if (supplyEntering && hot) verdict = 'CHURN'
  else if (supplyEntering) verdict = 'DISTRIBUTION'
  else verdict = 'UNKNOWN'

  // Score is evidence-weighted, capped at 100. Every point traces to a
  // named fact above — never a hidden constant.
  let score = 0
  score += Math.min(exited, 3) * 15 // supply leaving risky tiers (max 45)
  if (concentrationFalling === true) score += 15
  if (clusterDelta !== null && clusterDelta <= -config.minTierExitPct) score += 10
  if (quiet) score += 15
  if (hot) score += 15
  if (liquidityDelta !== null && liquidityDelta < -0.2) score -= 20
  score = Math.max(0, Math.min(100, score))

  const reason =
    verdict === 'UNKNOWN'
      ? exited === 0 && !supplyEntering
        ? 'no proven supply movement in either direction'
        : 'flow too thin to call a phase'
      : undefined

  return { verdict, score, readings: readings.length, deltas, evidence, ...(reason ? { reason } : {}) }
}
