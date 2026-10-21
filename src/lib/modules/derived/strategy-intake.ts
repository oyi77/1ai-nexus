// ─────────────────────────────────────────────────────────────
// Strategy intake — the I/O shell that feeds the pure evaluators.
//
// For one candidate mint it gathers the evidence the three operator
// strategies need and returns the best FIRING verdict:
//   · MC series (GeckoTerminal, keyless) → structure read
//   · price-guard holder count (TokenHolding, DB)
//   · classified-buyer facts + pairwise independence (cluster analysis)
//   · market row (liquidity / 24h volume) from accumulation-markets
//
// Every leg is failure-tolerant: a dead source yields null evidence,
// which the evaluators treat as "cannot pass", never as a pass. The
// module NEVER sends anything — delivery stays in the cron.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { fetchMcSeries, type McSeries } from './mc-series'
import { analyzeStructure, type McStructure, type StructureBar } from './mc-structure'
import {
  evaluateLevelFlip,
  evaluateSecondWave,
  evaluateWhaleComeback,
  STRATEGY_LABELS,
  type HolderContext,
  type IndependenceContext,
  type MarketContext,
  type StrategyConfig,
  type StrategyId,
  type StrategyVerdict,
  type StructureContext,
} from './strategy-evaluator'
import { planLadder, DEFAULT_WEIGHTS_3, type LadderPlan } from './ladder-planner'
import { areWalletsConnected } from './whale-clustering'
import {
  loadCallConfluence,
  describeConfluence,
  clearsConfluence,
  EMPTY_CONFLUENCE,
  type CallConfluence,
} from './call-confluence'
import type { MarketRow } from './dex-token-meta'
import type { CallFeedRow } from './call-confluence'

export interface StrategyIntakeInput {
  contract: string
  /** Buyers from the candidate row. */
  buyers: string[]
  /** Builder-classified buyer facts (status per address). */
  buyerStatus: Map<string, { status: string | null }>
  market: MarketRow | null
  /** Optional overrides (tests / env). */
  config?: Partial<StrategyConfig>
  /** Bars to pull for structure (default 300 hourly). */
  barLimit?: number
  /** Sizing input for the ladder; omit to skip ladder construction. */
  sizing?: { capitalUsd: number; riskPct: number }
  /** Inject a fetch for tests. */
  fetchFn?: typeof fetch
  /** Call groups that may vouch for a contract (confluence evidence). */
  trustedCallGroups?: readonly string[]
  /** Inject the call-feed loader (tests / batched reads). */
  callFeedSeam?: (nowMs: number, maxAgeMin?: number) => Promise<CallFeedRow[]>
  /**
   * Make call-group confluence a HARD gate: a contract that does not clear
   * the bar fires no strategy, exactly as if the structure rules failed.
   * Omit to keep confluence as reported evidence only.
   */
  requireConfluence?: { minGroups: number; trustedOnly?: boolean }
}
export interface StrategyIntakeResult {
  contract: string
  fired: StrategyVerdict | null
  /** Every strategy that was evaluated (fired or not) — full audit trail. */
  verdicts: StrategyVerdict[]
  structure: McStructure | null
  ladder: LadderPlan | null
  /** Human-readable structure summary lines for the alert body. */
  structureLines: string[]
  /** One line per refused strategy, e.g. "Second Wave — higher-low: last low is LOWER". */
  refusals: string[]
  /** Where the price-guard holder count came from (null = unknown). */
  guardSource: 'tracked' | 'onchain' | null
  /**
   * Telegram call-group confluence for this contract. Reported on the alert
   * and available to the gate; `available: false` means the feed was not
   * readable, never "no group called it".
   */
  confluence: CallConfluence
  /** One readable line for the alert body. */
  confluenceLine: string
  /**
   * Result of the hard confluence gate when one was configured (null when
   * confluence is evidence only). `pass: false` is why `fired` is null.
   */
  confluenceBar: { pass: boolean; detail: string } | null
}

// Statuses that count as a classified buyer. The discovery engine writes
// 'WHALE' / 'QUALIFIED_SMART_MONEY'; the older sync paths wrote the mixed
// variants, so all four are accepted rather than silently dropping whales.
const CLASSIFIED = new Set(['WHALE', 'WHALE_AND_SMART_MONEY', 'QUALIFIED_SMART_MONEY', 'SMART_MONEY'])

/**
 * Price-guard holders: wallets currently HOLDING the mint.
 *
 * Two sources, in order:
 *   1. TokenHolding rows for tracked wallets (the operator's own list) —
 *      the strongest evidence, because those wallets are graded.
 *   2. RugCheck top holders (on-chain), used when the tracked table has
 *      nothing for this mint. It is a weaker signal (unranked wallets),
 *      so it is reported as `source: 'onchain'` and the caller can
 *      decide whether to trust it as a "guard".
 *
 * A null return means "count unknown" — the evaluator refuses on null,
 * never on an invented number.
 */
export async function countPriceGuardHolders(
  contract: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ count: number; source: 'tracked' | 'onchain' } | null> {
  try {
    const rows = await prisma.tokenHolding.findMany({
      where: { token: { address: contract, chain: 'solana' } },
      select: { walletId: true },
    })
    const tracked = new Set(rows.map((r) => r.walletId)).size
    if (tracked > 0) return { count: tracked, source: 'tracked' }
  } catch {
    // fall through to the on-chain leg — a DB miss is not a verdict
  }
  try {
    const res = await fetchFn(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(contract)}/report`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { topHolders?: unknown[] }
    const top = Array.isArray(json?.topHolders) ? json.topHolders.length : 0
    // Only holders ABOVE dust count as guarding the price. RugCheck returns
    // the ranked top list, so its length IS the meaningful holder count —
    // totalHolders (120k for one probe) counts airdrop dust, not guards.
    return top > 0 ? { count: top, source: 'onchain' } : null
  } catch {
    return null
  }
}

/** Pairwise cluster check for the funding-source rule. Never throws. */
async function independenceOf(buyers: string[]): Promise<IndependenceContext> {
  const checked: IndependenceContext['checked'] = []
  for (let i = 0; i < buyers.length; i++) {
    for (let j = i + 1; j < buyers.length; j++) {
      try {
        const res = await areWalletsConnected(buyers[i], buyers[j])
        checked.push({ a: buyers[i], b: buyers[j], connected: res.connected, confidence: res.confidence })
      } catch {
        checked.push({ a: buyers[i], b: buyers[j], connected: null, confidence: null })
      }
    }
  }
  return { checked }
}

function structureLinesOf(s: McStructure | null): string[] {
  if (!s) return ['structure: no MC series (GeckoTerminal has no usable pool)']
  const lines: string[] = []
  if (s.base) {
    lines.push(
      `base $${(s.base.lowUsd / 1e6).toFixed(2)}M–$${(s.base.highUsd / 1e6).toFixed(2)}M (${(s.base.widthPct * 100).toFixed(0)}% wide, ${s.base.bars} bars)`,
    )
  } else {
    lines.push('base: no consolidation range in the recent window')
  }
  lines.push(
    s.lastLows
      ? `swing lows $${(s.lastLows[0].priceUsd / 1e6).toFixed(2)}M → $${(s.lastLows[1].priceUsd / 1e6).toFixed(2)}M (${s.higherLow ? 'higher low' : 'LOWER low'})`
      : 'swing lows: not enough pivots',
  )
  lines.push(
    s.minorResistanceUsd !== null
      ? `minor resistance $${(s.minorResistanceUsd / 1e6).toFixed(2)}M`
      : 'minor resistance: none resolvable',
  )
  if (s.breakout) {
    lines.push(
      `breakout: closed $${(s.breakout.closeUsd / 1e6).toFixed(2)}M (+${(s.breakout.marginPct * 100).toFixed(1)}%)`,
    )
  }
  if (s.retest) {
    lines.push(
      `retest: ${s.retest.held ? 'HELD' : 'FAILED'} at $${(s.retest.levelUsd / 1e6).toFixed(2)}M (dip ${(s.retest.dipPct * 100).toFixed(1)}%)`,
    )
  }
  if (s.volume.downRatio !== null) {
    lines.push(
      `sell pressure ${s.volume.downRatio < 1 ? 'fading' : 'RISING'} (down-vol ${s.volume.downRatio.toFixed(2)}×)`,
    )
  }
  if (s.volume.upRatio !== null) {
    lines.push(`buy volume ${s.volume.upRatio >= 1 ? 'returning' : 'not yet back'} (${s.volume.upRatio.toFixed(2)}×)`)
  }
  if (s.newLowRecently) lines.push('⚠ still printing new lows')
  return lines
}

/** The first failing ref, as one readable line. */
function firstFailure(v: StrategyVerdict): string | null {
  const bad = v.refs.find((r) => !r.passed)
  return bad ? `${bad.rule}: ${bad.detail}` : null
}

/**
 * Evaluate all three strategies for one mint and return the best firing
 * one (highest confidence; ties broken by strategy order, which is the
 * operator's stated preference). Returns fired=null when none pass.
 */
export async function evaluateStrategiesFor(
  input: StrategyIntakeInput,
): Promise<StrategyIntakeResult> {
  const series: McSeries | null = await fetchMcSeries(input.contract, {
    timeframe: 'hour',
    barLimit: input.barLimit ?? 300,
    fetchFn: input.fetchFn,
  })
  const bars: StructureBar[] = series ? series.bars : []
  const structure = bars.length > 0 ? analyzeStructure(bars) : null

  const guard = await countPriceGuardHolders(input.contract, input.fetchFn)
  const holders: HolderContext = { trackedHolders: guard ? guard.count : null }

  const market: MarketContext = {
    liquidityUsd: input.market?.liquidityUsd ?? null,
    volume24hUsd: input.market?.volume24hUsd ?? null,
  }

  let classifiedBuyerCount = 0
  for (const b of input.buyers) {
    const status = input.buyerStatus.get(b)?.status ?? null
    if (status && CLASSIFIED.has(status.toUpperCase())) classifiedBuyerCount++
  }

  const sctx: StructureContext = {
    structure,
    buyers: input.buyers,
    hasClassifiedBuyer: classifiedBuyerCount > 0,
    classifiedBuyerCount,
  }
  const independence = await independenceOf(input.buyers)
  // One feed read per contract; the loader is injected in tests and by the
  // cron when it batches (see evaluateStrategiesFor's callFeedSeam).
  const confluence = (await loadCallConfluence([input.contract], {
    trustedGroups: input.trustedCallGroups,
    loadFeed: input.callFeedSeam,
  })).get(input.contract) ?? EMPTY_CONFLUENCE(input.contract)

  const verdicts: StrategyVerdict[] = [
    evaluateSecondWave(sctx, market, holders, input.config),
    evaluateLevelFlip(sctx, market, holders, input.config),
    evaluateWhaleComeback(sctx, market, holders, input.config, independence),
  ]

  const firedList = verdicts
    .filter((v) => v.fired)
    .sort((a, b) => b.confidence - a.confidence)
  const gated = applyConfluenceBar(firedList, confluence, input.requireConfluence)
  const fired = gated.fired

  let ladder: LadderPlan | null = null
  if (fired && input.sizing && fired.entryUsd !== null && fired.stopUsd !== null) {
    const entry = fired.entryUsd
    const stop = fired.stopUsd
    // Tranches: retest/reclaim first, then the break — each with its own
    // reason, per the operator's ladder rule.
    ladder = planLadder(
      {
        capitalUsd: input.sizing.capitalUsd,
        riskPct: input.sizing.riskPct,
        stopUsd: stop,
        tranches: [
          { reason: 'retest', atMcUsd: entry * 0.995, weight: DEFAULT_WEIGHTS_3[0] },
          { reason: 'reclaim', atMcUsd: entry, weight: DEFAULT_WEIGHTS_3[1] },
          { reason: 'breakout', atMcUsd: entry * 1.02, weight: DEFAULT_WEIGHTS_3[2] },
        ],
      },
      fired.targetUsd,
    )
  }

  const refusals = verdicts
    .filter((v) => !v.fired)
    .map((v) => `${STRATEGY_LABELS[v.strategy] ?? v.strategy} — ${firstFailure(v) ?? 'no rule failed?'}`)
  // The bar refusal joins the structure refusals so the operator's log
  // answers "why was this dropped" with one read.
  refusals.push(...gated.refusals)

  return {
    contract: input.contract,
    fired,
    verdicts,
    structure,
    ladder,
    structureLines: structureLinesOf(structure),
    refusals,
    guardSource: guard?.source ?? null,
    confluence,
    confluenceLine: describeConfluence(confluence),
    confluenceBar: gated.bar,
  }
}

/**
 * Apply the optional hard confluence gate to the already-ranked firing list.
 *
 * Split out as a pure function so the wiring is testable without an HTTP
 * fetch: the failure mode that matters is a bar that is computed but never
 * applied, which leaves the alert claiming an entry the bar refused.
 */
export function applyConfluenceBar(
  firedList: StrategyVerdict[],
  confluence: CallConfluence,
  bar: { minGroups: number; trustedOnly?: boolean } | undefined,
): { fired: StrategyVerdict | null; bar: { pass: boolean; detail: string } | null; refusals: string[] } {
  const cleared = bar ? clearsConfluence(confluence, bar.minGroups, bar.trustedOnly === true) : null
  const suppressed = cleared !== null && !cleared.pass
  return {
    fired: suppressed ? null : (firedList[0] ?? null),
    bar: cleared,
    refusals: suppressed ? [`Call confluence — ${cleared.detail}`] : [],
  }
}

export type { StrategyId }
