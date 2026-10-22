// ─────────────────────────────────────────────────────────────
// Strategy evaluator — the operator's THREE live entry strategies,
// expressed as hard gates over MC structure + market data. Pure:
// the caller supplies the structure reading, the market row, and
// the holder/wallet context, so every verdict is unit-testable.
//
// Shared hard requirements (operator mandate):
//   · ≥ MIN_PRICE_GUARD_HOLDERS tracked holders "guarding the price"
//     — fewer than 10 and the token has no holding floor, so the
//     setup is refused regardless of structure.
//   · Every strategy has an MC BAND matched to the operator's own
//     worked examples — the old global <$1M cap is GONE: it would
//     have rejected all three of those examples.
//   · Liquidity floor: an entry is useless if the exit is not
//     executable (verified impostors had $3–40k).
//   · 24h volume floor: whale buys must have an active market
//     behind them, not a dead pair.
//
// Verdicts carry REASONS (refs), not vibes: every pass and every
// rejection names the exact rule so the alert and the operator can
// audit the call.
// ─────────────────────────────────────────────────────────────

export type StrategyId = 'second_wave' | 'level_flip' | 'whale_comeback'

export interface MarketContext {
  liquidityUsd: number | null
  volume24hUsd: number | null
}

import type { ConsolidationBase, McStructure } from './mc-structure'

/** Holder-guard context: how many tracked wallets currently hold the token. */
export interface HolderContext {
  /** Tracked holder count from the holdings scanner. null = unproven. */
  trackedHolders: number | null
}

/**
 * Wallet-independence context for Whale Comeback's funding-source rule.
 *
 * The operator's mandate is explicit: "cek funding source ya, jangan sampe
 * satu orang nyebar ke banyak wallet". So an UNCHECKED or UNKNOWN pair is
 * not evidence of independence — it is absence of evidence, and the gate
 * refuses until the cluster check actually answers. Only `false` (checked,
 * not connected) passes; `true` and `null` both refuse.
 */
export interface IndependenceContext {
  checked: Array<{ a: string; b: string; connected: boolean | null; confidence: number | null }>
}

export interface StructureContext {
  structure: McStructure | null
  /** Buyers who bought this token in the window (whale-comeback). */
  buyers: string[]
  /** True when ≥1 buyer carries a WHALE/SMART_MONEY status in the DB. */
  hasClassifiedBuyer: boolean
  /** How many of the buyers carry a classified (non-fresh) status. */
  classifiedBuyerCount: number
}

export interface StrategyRefs {
  rule: string
  passed: boolean
  detail: string
}

export interface StrategyVerdict {
  strategy: StrategyId
  fired: boolean
  /** 0..100 — only meaningful when fired. */
  confidence: number
  refs: StrategyRefs[]
  entryUsd: number | null
  stopUsd: number | null
  targetUsd: number | null
  rr: number | null
}

/** Rules in the "setup readable" group: they describe the SHAPE, not the market. */
export const STRUCTURE_RULES: ReadonlySet<string> = new Set([
  'no-new-lows',
  'higher-low',
  'consolidation-base',
  'selling-pressure-fading',
  'buy-volume-returning',
  'break-and-close-above-resistance',
  'breakout-with-volume',
  'retest-occurred-and-held',
  'retest-volume-shrinking',
  'prior-history',
  'corrected-from-high',
  'classified-whale-buys',
])

/**
 * Rules that refuse on MISSING PROOF rather than on a market reading.
 *
 * A failed market rule is a near-miss (the setup existed, the market said no)
 * and still scores. A failed evidence gate is not a near-miss: the setup may
 * be flawless and still uninvestable. Scoring it would rank a clustered pair
 * of whales — one funder, one decision — next to genuinely weaker tokens.
 */
export const EVIDENCE_BLOCKED: ReadonlySet<string> = new Set(['wallet-independence'])

/**
 * Rules whose FAILURE is only readable when they had a reference point to be
 * judged against. `no-reentry-into-range` without a base is not "price went
 * back into the range" — there is no range, so nothing was measured. That is
 * the same unproven verdict as an unanswered cluster check and scores 0.
 * With a base resolved, a failed re-entry IS a market reading (price really
 * did fall back inside the old range) and scores like any other near-miss.
 */
export const UNJUDGEABLE_RULE = 'no-reentry-into-range'

export interface StrategyConfig {
  minPriceGuardHolders: number
  minLiquidityUsd: number
  minVolume24hUsd: number
  /** Base-window volume/shares: recent buy volume must be this fraction of prior. */
  minUpVolumeRatio: number
  /**
   * MC band per strategy, from the operator's worked examples. NOT a global cap.
   */
  baseBandByStrategy: Record<StrategyId, { min: number; max: number }>
  /**
   * A stop must sit BELOW the whole old range, else touching the base counts
   * as support holding and "no re-entry" is unenforceable: price never had to
   * leave the range for the stop to survive.
   */
  stopBelowBaseRange: boolean
}

export const STRATEGY_DEFAULTS: StrategyConfig = {
  minPriceGuardHolders: 10,
  minLiquidityUsd: 50_000,
  minVolume24hUsd: 50_000,
  minUpVolumeRatio: 0.8,
  // MC bands from the operator's worked examples (per strategy, NOT a global cap):
  //   Second Wave: pump 2M→6M, base 3.6–4.4, entry 4.6  → current 2M–6M
  //   Level Flip: resist 10M, entry 10.6, retest 10.1     → current 8M–15M
  //   Whale Comeback: peak 40M, base 17–20, entry 20.5    → current 10M–45M
  baseBandByStrategy: {
    second_wave: { min: 2_000_000, max: 6_000_000 },
    level_flip: { min: 8_000_000, max: 15_000_000 },
    whale_comeback: { min: 10_000_000, max: 45_000_000 },
  },
  stopBelowBaseRange: true,
}

const STRATEGY_NAMES: Record<StrategyId, string> = {
  second_wave: 'Second Wave',
  level_flip: 'Level Flip',
  whale_comeback: 'Whale Comeback',
}

function clamp(c: Partial<StrategyConfig> | undefined): StrategyConfig {
  return { ...STRATEGY_DEFAULTS, ...(c ?? {}) }
}

/**
 * Shared vetoes. Every strategy first needs: ≥10 price-guard holders,
 * executable liquidity, live 24h volume, and a non-dead structure read.
 */
function sharedRefs(
  strategy: StrategyId,
  market: MarketContext,
  holders: HolderContext,
  cfg: StrategyConfig,
  currentMcUsd: number | null,
): StrategyRefs[] {
  const band = cfg.baseBandByStrategy[strategy]
  const refs: StrategyRefs[] = []

  const h = holders.trackedHolders
  refs.push({
    rule: 'price-guard-holders',
    passed: h !== null && h >= cfg.minPriceGuardHolders,
    detail: h === null
      ? `holders unverified (need >= ${cfg.minPriceGuardHolders})`
      : `${h}/${cfg.minPriceGuardHolders} tracked holders`,
  })

  refs.push({
    rule: 'liquidity-floor',
    passed: market.liquidityUsd !== null && market.liquidityUsd >= cfg.minLiquidityUsd,
    detail: market.liquidityUsd === null
      ? 'liquidity unverified'
      : `$${Math.round(market.liquidityUsd).toLocaleString()} vs $${(cfg.minLiquidityUsd / 1000).toFixed(0)}k floor ` +
        (market.liquidityUsd >= cfg.minLiquidityUsd ? '(meets floor)' : '(BELOW floor)'),
  })

  refs.push({
    rule: 'volume-floor-24h',
    passed: market.volume24hUsd !== null && market.volume24hUsd >= cfg.minVolume24hUsd,
    detail: market.volume24hUsd === null
      ? '24h volume unverified'
      : `$${Math.round(market.volume24hUsd).toLocaleString()} vs $${(cfg.minVolume24hUsd / 1000).toFixed(0)}k floor ` +
        (market.volume24hUsd >= cfg.minVolume24hUsd ? '(meets floor)' : '(BELOW floor)'),
  })

  refs.push({
    rule: 'mc-band',
    passed: currentMcUsd !== null && currentMcUsd >= band.min && currentMcUsd <= band.max,
    detail: currentMcUsd === null
      ? 'current MC unavailable'
      : `MC $${(currentMcUsd / 1e6).toFixed(2)}M vs $${(band.min / 1e6).toFixed(1)}M–$${(band.max / 1e6).toFixed(1)}M band ` +
        (currentMcUsd >= band.min && currentMcUsd <= band.max ? '(inside band)' : `(${currentMcUsd < band.min ? 'BELOW' : 'ABOVE'} band)`),
  })

  return refs
}

function allPassed(refs: StrategyRefs[]): boolean {
  return refs.every((r) => r.passed)
}

/**
 * Stops derived from a range floor sit this far BELOW it. A stop resting on
 * the floor is stopped by the first wick that validates the support, before
 * the setup's claim (the reclaim held) is even tested.
 */
const FLOOR_STOP_MARGIN = 0.02

/** SECOND WAVE — pumped, consolidating, HIGHER LOW, closing above minor resistance. */
export function evaluateSecondWave(
  s: StructureContext,
  market: MarketContext,
  holders: HolderContext,
  cfg: Partial<StrategyConfig> = {},
): StrategyVerdict {
  const c = clamp(cfg)
  const refs: StrategyRefs[] = []
  const structure = s.structure

  refs.push(...sharedRefs('second_wave', market, holders, c, structure?.currentMcUsd ?? null))

  const node = structure
  if (node) {
    refs.push({
      rule: 'no-new-lows',
      passed: !node.newLowRecently,
      detail: node.newLowRecently ? 'recent bars printed a new low — still bleeding, not a base' : 'no new low in the recent window',
    })
    refs.push({
      rule: 'higher-low',
      passed: node.higherLow,
      detail: node.lastLows === null
        ? 'insufficient swing lows to prove structure'
        : node.higherLow
          ? `higher low $${(node.lastLows[0].priceUsd / 1e6).toFixed(2)}M → $${(node.lastLows[1].priceUsd / 1e6).toFixed(2)}M`
          : `last low is LOWER ($${(node.lastLows[1].priceUsd / 1e6).toFixed(2)}M) — structure not forming`,
    })
    refs.push({
      rule: 'consolidation-base',
      passed: node.base !== null,
      detail: node.base === null
        ? 'no consolidation base over the last window'
        : `base $${(node.base.lowUsd / 1e6).toFixed(2)}M–$${(node.base.highUsd / 1e6).toFixed(2)}M (${node.base.widthPct.toFixed(0)}% wide, ${node.base.bars} bars)`,
    })
    refs.push({
      rule: 'selling-pressure-fading',
      passed: node.volume.downRatio === null || node.volume.downRatio < 1,
      detail: node.volume.downRatio === null
        ? 'no prior-windowdown-volume to compare'
        : `down-volume ratio ${node.volume.downRatio.toFixed(2)} (prior → recent)`,
    })
    refs.push({
      rule: 'buy-volume-returning',
      passed: node.volume.upRatio !== null && node.volume.upRatio >= c.minUpVolumeRatio,
      detail: node.volume.upRatio === null
        ? 'no prior-window up-volume to compare'
        : `up-volume ratio ${node.volume.upRatio.toFixed(2)}`,
    })
    refs.push({
      rule: 'break-and-close-above-resistance',
      passed: node.breakout !== null,
      detail: node.breakout === null
        ? `no close above resistance ${node.minorResistanceUsd === null ? '(none resolvable)' : `$${(node.minorResistanceUsd / 1e6).toFixed(2)}M`}`
        : `closed $${(node.breakout.closeUsd / 1e6).toFixed(2)}M above $${(node.breakout.levelUsd / 1e6).toFixed(2)}M (+${(node.breakout.marginPct * 100).toFixed(1)}%)`,
    })
  } else {
    refs.push({ rule: 'structure-available', passed: false, detail: 'no MC series — cannot evaluate structure' })
  }

  const fired = allPassed(refs)
  let entryUsd: number | null = null
  let stopUsd: number | null = null
  let targetUsd: number | null = null
  let rr: number | null = null
  if (fired && node?.breakout && node.base) {
    entryUsd = node.breakout.closeUsd
    stopUsd = node.base.lowUsd
    targetUsd = node.minorResistanceUsd !== null ? node.minorResistanceUsd * 1.45 : node.breakout.closeUsd * 1.5
    rr = (targetUsd / entryUsd - 1) / (entryUsd / stopUsd - 1)
  }

  return { strategy: 'second_wave', fired, confidence: structure ? confidenceOf(refs, structure) : 0, refs, entryUsd, stopUsd, targetUsd, rr }
}

/** LEVEL FLIP — resist, breakout, retest that HOLDS, then continue. */
export function evaluateLevelFlip(
  s: StructureContext,
  market: MarketContext,
  holders: HolderContext,
  cfg: Partial<StrategyConfig> = {},
): StrategyVerdict {
  const c = clamp(cfg)
  const refs: StrategyRefs[] = []
  const structure = s.structure

  refs.push(...sharedRefs('level_flip', market, holders, c, structure?.currentMcUsd ?? null))

  if (structure) {
    refs.push({
      rule: 'established-volume',
      passed: (market.volume24hUsd ?? 0) >= c.minVolume24hUsd * 2,
      detail: market.volume24hUsd === null
        ? '24h volume unverified'
        : `$${Math.round(market.volume24hUsd).toLocaleString()} (needs 2× the floor: real structure takes real money)`,
    })
    refs.push({
      rule: 'breakout-with-volume',
      passed: structure.breakout !== null && (structure.breakout.closeUsd / (structure.minorResistanceUsd ?? 1) - 1) >= 0.02,
      detail: structure.breakout === null
        ? 'no breakout close above resistance'
        : `breakout +${(structure.breakout.marginPct * 100).toFixed(1)}% over $${(structure.breakout.levelUsd / 1e6).toFixed(2)}M`,
    })
    refs.push({
      rule: 'retest-occurred-and-held',
      passed: structure.retest !== null && structure.retest.held,
      detail: structure.retest === null
        ? 'no retest of the broken level yet'
        : structure.retest.held
          ? `retest at $${(structure.retest.levelUsd / 1e6).toFixed(2)}M held (dip ${(structure.retest.dipPct * 100).toFixed(1)}%)`
          : `retest FAILED to hold (dip ${(structure.retest.dipPct * 100).toFixed(1)}% and close under the level)`,
    })
    refs.push({
      rule: 'retest-volume-shrinking',
      passed: structure.volume.upRatio !== null && structure.volume.upRatio < 1.2,
      detail: structure.volume.upRatio === null
        ? 'no comparable window'
        : `up-volume ratio ${structure.volume.upRatio.toFixed(2)} — low churn during the retest`,
    })
    refs.push({
      rule: 'no-reentry-into-range',
      passed: structure.base !== null && structure.currentMcUsd > structure.base.highUsd,
      detail: structure.base === null
        ? 'no consolidation base resolvable — the old range this reclaim was supposed to leave is unmeasurable, so "did not re-enter" is unproven'
        : structure.currentMcUsd > structure.base.highUsd
          ? 'price holds above the old range'
          : 'price is back INSIDE the old range — failed reclaim',
    })
    const stop = stopForFlip(structure)
    const stopRef = stop === null ? null : baseRangeStopRef('stop-below-base-range', structure.base, stop, c.stopBelowBaseRange)
    if (stopRef) refs.push(stopRef)
  } else {
    refs.push({ rule: 'structure-available', passed: false, detail: 'no MC series — cannot evaluate structure' })
  }

  const fired = allPassed(refs)
  const entryUsd = structure ? structure.currentMcUsd : null
  const stopUsd = structure ? stopForFlip(structure) : null
  const plan = entryUsd !== null && stopUsd !== null && entryUsd > stopUsd
    ? flipPlan(entryUsd, stopUsd)
    : { targetUsd: null, rr: null }

  return { strategy: 'level_flip', fired, confidence: structure ? confidenceOf(refs, structure) : 0, refs, entryUsd, stopUsd, targetUsd: plan.targetUsd, rr: plan.rr }
}

/**
 * The one range-floor rule for every strategy: once a base exists the stop
 * sits strictly BELOW its floor (a stop resting on the floor is stopped by
 * the first wick that validates that support), otherwise the fallback applies.
 */
function stopBelowBase(structure: McStructure, fallbackUsd: number): number {
  return structure.base ? structure.base.lowUsd * (1 - FLOOR_STOP_MARGIN) : fallbackUsd
}

/** Level Flip stop: just under the base floor, else just under the broken level. */
function stopForFlip(structure: McStructure): number | null {
  if (structure.base) return stopBelowBase(structure, structure.base.lowUsd)
  if (structure.retest) return structure.retest.levelUsd
  return null
}

/**
 * Level Flip plan: TP = the retest-held level plus a fixed 2.5R extension.
 * Returned for refused verdicts too — the log must show the plan the setup
 * WOULD have used, not blanks that hide which rule refused it.
 */
function flipPlan(entryUsd: number, stopUsd: number): { targetUsd: number | null; rr: number | null } {
  const riskPct = (entryUsd - stopUsd) / entryUsd
  const targetUsd = entryUsd * (1 + riskPct + 2.5)
  return { targetUsd, rr: (targetUsd / entryUsd - 1) / riskPct }
}

/** WHALE COMEBACK — old runner, classified whales buy again after a correction. */
export function evaluateWhaleComeback(
  s: StructureContext,
  market: MarketContext,
  holders: HolderContext,
  cfg: Partial<StrategyConfig> = {},
  independence?: IndependenceContext,
): StrategyVerdict {
  const c = clamp(cfg)
  const refs: StrategyRefs[] = []
  const structure = s.structure

  refs.push(...sharedRefs('whale_comeback', market, holders, c, structure?.currentMcUsd ?? null))

  if (structure) {
    refs.push({
      rule: 'prior-history',
      passed: structure.seriesHighUsd >= (c.baseBandByStrategy.whale_comeback.min * 1.5),
      detail: `series high $${(structure.seriesHighUsd / 1e6).toFixed(1)}M (proves a runner past, not a fresh mint)`,
    })
    refs.push({
      rule: 'corrected-from-high',
      passed: structure.currentMcUsd < structure.seriesHighUsd * 0.8,
      detail: `current $${(structure.currentMcUsd / 1e6).toFixed(1)}M vs peak $${(structure.seriesHighUsd / 1e6).toFixed(1)}M — a real correction, not a straight line up`,
    })
    refs.push({
      rule: 'no-new-lows',
      passed: !structure.newLowRecently,
      detail: structure.newLowRecently ? 'base is still bleeding — no holding floor yet' : 'base holding',
    })
    refs.push({
      rule: 'selling-pressure-fading',
      passed: structure.volume.downRatio === null || structure.volume.downRatio < 1,
      detail: structure.volume.downRatio === null
        ? 'no window to compare'
        : `down-volume ratio ${structure.volume.downRatio.toFixed(2)}`,
    })
    refs.push({
      rule: 'classified-whale-buys',
      passed: s.hasClassifiedBuyer && s.classifiedBuyerCount > 0,
      detail: `${s.classifiedBuyerCount} WHALE/SMART_MONEY buyer(s) in the window`,
    })
    refs.push(...independenceRefs(s, independence))
    const stop = stopBelowBase(structure, structure.currentMcUsd * 0.8)
    const stopRef = baseRangeStopRef('stop-below-base-range', structure.base, stop, c.stopBelowBaseRange)
    if (stopRef) refs.push(stopRef)
  } else {
    refs.push({ rule: 'structure-available', passed: false, detail: 'no MC series — cannot evaluate structure' })
  }

  if (structure) {
    const targetUsd = structure.seriesHighUsd * 0.8
    refs.push({
      rule: 'target-above-entry',
      passed: targetUsd > structure.currentMcUsd,
      detail: targetUsd > structure.currentMcUsd
        ? `target $${(targetUsd / 1e6).toFixed(1)}M is above entry $${(structure.currentMcUsd / 1e6).toFixed(1)}M`
        : `target $${(targetUsd / 1e6).toFixed(1)}M is NOT above entry $${(structure.currentMcUsd / 1e6).toFixed(1)}M — the plan has no upside`,
    })
  }

  const fired = allPassed(refs)
  const entryUsd = structure ? structure.currentMcUsd : null
  const stopUsd = structure ? stopBelowBase(structure, structure.currentMcUsd * 0.8) : null
  const targetUsd = structure ? structure.seriesHighUsd * 0.8 : null
  const rr = entryUsd !== null && stopUsd !== null && targetUsd !== null && targetUsd > entryUsd && entryUsd > stopUsd
    ? (targetUsd / entryUsd - 1) / (entryUsd / stopUsd - 1)
    : null

  return { strategy: 'whale_comeback', fired, confidence: structure ? confidenceOf(refs, structure) : 0, refs, entryUsd, stopUsd, targetUsd, rr }
}

/**
 * Funding-source rule (operator mandate): "cek funding source ya, jangan
 * sampe 1 orang nyebar ke banyak wallet." Only a checked pair that came
 * back NOT connected is evidence of independence. A clustered pair refuses;
 * an unchecked or unknown pair also refuses, because "belum dicek" is not
 * "aman" — the gate stays closed until the cluster check answers.
 */
function independenceRefs(s: StructureContext, independence?: IndependenceContext): StrategyRefs[] {
  const refs: StrategyRefs[] = []
  const evidence = independence?.checked ?? []
  for (let i = 0; i < s.buyers.length; i++) {
    for (let j = i + 1; j < s.buyers.length; j++) {
      const a = s.buyers[i]
      const b = s.buyers[j]
      const hit = evidence.find(
        (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
      )
      const label = `${a.slice(0, 6)}…/${b.slice(0, 6)}…`
      if (hit?.connected === false) {
        refs.push({
          rule: 'wallet-independence',
          passed: true,
          detail: `${label} independent (verified, conf ${hit.confidence ?? 'n/a'})`,
        })
      } else if (hit?.connected === true) {
        refs.push({
          rule: 'wallet-independence',
          passed: false,
          detail: `${label} CLUSTERED (conf ${hit.confidence ?? 'n/a'}) — one funder across wallets, not independent whales`,
        })
      } else if (hit) {
        refs.push({
          rule: 'wallet-independence',
          passed: false,
          detail: `${label} cluster check returned UNKNOWN (conf ${hit.confidence ?? 'n/a'}) — funding source unproven, not assumed safe`,
        })
      } else {
        refs.push({
          rule: 'wallet-independence',
          passed: false,
          detail: `${label} NOT CHECKED — funding source unproven, not assumed safe`,
        })
      }
    }
  }
  if (refs.length === 0) {
    refs.push({ rule: 'wallet-independence', passed: false, detail: 'fewer than 2 buyers — independence cannot be established' })
  }
  return refs
}

/**
 * Confidence describes how much of the READABLE setup is proven. A refused
 * verdict with zero READABLE evidence (series missing, market context
 * missing, no buyer classification) is not "10% likely" — it is unproven,
 * and unproven reports 0. A rule that FAILED while the setup was readable
 * still scores: the shape existed and the market said no, which is a
 * measurable near-miss, not an unknown.
 *
 * An EVIDENCE_BLOCKED failure is the exception: a proof gate that came back
 * negative is not a weaker reading of the same setup, so it cannot be scored
 * as one.
 *
 * `no-reentry-into-range` follows the same rule for the only case where it is
 * unreadable: no base means no reference range, so its failure is a missing
 * measurement rather than a market reading. Without a base the verdict is
 * unscorable. With a base it is an ordinary failed rule and scores normally.
 */
function confidenceOf(refs: StrategyRefs[], structure: McStructure | null): number {
  if (refs.length === 0) return 0
  if (refs.some((r) => !r.passed && EVIDENCE_BLOCKED.has(r.rule))) return 0
  const reentry = refs.find((r) => r.rule === UNJUDGEABLE_RULE && !r.passed)
  if (reentry && !structure?.base) return 0
  const passed = refs.filter((r) => r.passed).length
  const readable = refs.filter((r) => STRUCTURE_RULES.has(r.rule)).length > 0
  if (!readable) return 0
  const base = (passed / refs.length) * 60
  const bonus = allPassed(refs) ? 30 : 0
  return Math.max(0, Math.min(100, Math.round(base + bonus)))
}

/**
 * "No re-entry into the range" only means something when the exit was real.
 * With a stop INSIDE the old range, the first touch of the base is a
 * validated support, so a reclaim never had to survive anything.
 */
function baseRangeStopRef(rule: string, base: ConsolidationBase | null, stopUsd: number, enabled: boolean): StrategyRefs | null {
  if (!enabled || base === null) return null
  const passed = stopUsd < base.lowUsd
  return {
    rule,
    passed,
    detail: passed
      ? `stop $${(stopUsd / 1e6).toFixed(2)}M sits below the old range floor $${(base.lowUsd / 1e6).toFixed(2)}M`
      : `stop $${(stopUsd / 1e6).toFixed(2)}M sits INSIDE the old range $${(base.lowUsd / 1e6).toFixed(2)}M–$${(base.highUsd / 1e6).toFixed(2)}M — a touch of the base would stop the re-entry before the reclaim is tested`,
  }
}

export const STRATEGY_LABELS = STRATEGY_NAMES
