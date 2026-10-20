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

import type { McStructure } from './mc-structure'

/** Holder-guard context: how many tracked wallets currently hold the token. */
export interface HolderContext {
  /** Tracked holder count from the holdings scanner. null = unproven. */
  trackedHolders: number | null
}

/** Wallet-independence context for Whale Comeback's funding-source rule. */
export interface IndependenceContext {
  /**
   * For each pair of buyers, true when the analyzer says they are NOT
   * linked (cluster analysis / funding-trace evidence). A null entry
   * means unknown — Whale Comeback treats unknown as INDEPENDENT with a
   * confidence penalty, matching the operator's "check funding source".
   */
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

export interface StrategyConfig {
  minPriceGuardHolders: number
  minLiquidityUsd: number
  minVolume24hUsd: number
  /** Base-window volume/shares: recent buy volume must be this fraction of prior. */
  minUpVolumeRatio: number
  /** Base break invalidation ref for alerts. */
  baseBandByStrategy: Record<StrategyId, { min: number; max: number }>
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

  return { strategy: 'second_wave', fired, confidence: fired ? confidenceOf(refs) : 0, refs, entryUsd, stopUsd, targetUsd, rr }
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
      passed: structure.currentMcUsd > (structure.base?.highUsd ?? structure.currentMcUsd),
      detail: structure.base === null
        ? 'no base range to fall back into (price is above it)'
        : structure.currentMcUsd > structure.base.highUsd
          ? 'price holds above the old range'
          : 'price is back INSIDE the old range — failed reclaim',
    })
  } else {
    refs.push({ rule: 'structure-available', passed: false, detail: 'no MC series — cannot evaluate structure' })
  }

  const fired = allPassed(refs)
  let entryUsd: number | null = null
  let stopUsd: number | null = null
  let targetUsd: number | null = null
  let rr: number | null = null
  if (fired && structure?.retest) {
    entryUsd = structure.retest.atMs !== 0 ? structure.currentMcUsd : null
    stopUsd = structure.base ? structure.base.lowUsd : entryUsd
    targetUsd = entryUsd !== null && stopUsd !== null ? entryUsd * ((entryUsd - stopUsd) / entryUsd + 2.5) : null
    rr = targetUsd !== null && entryUsd !== null && stopUsd !== null && entryUsd > stopUsd
      ? (targetUsd / entryUsd - 1) / (entryUsd / stopUsd - 1)
      : null
  }

  return { strategy: 'level_flip', fired, confidence: fired ? confidenceOf(refs) : 0, refs, entryUsd, stopUsd, targetUsd, rr }
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
  } else {
    refs.push({ rule: 'structure-available', passed: false, detail: 'no MC series — cannot evaluate structure' })
  }

  const fired = allPassed(refs)
  let entryUsd: number | null = null
  let stopUsd: number | null = null
  let targetUsd: number | null = null
  let rr: number | null = null
  if (fired && structure) {
    entryUsd = structure.currentMcUsd
    stopUsd = structure.base ? structure.base.lowUsd : entryUsd * 0.8
    targetUsd = structure.seriesHighUsd * 0.8
    rr = entryUsd > stopUsd ? (targetUsd / entryUsd - 1) / (entryUsd / stopUsd - 1) : null
  }

  return { strategy: 'whale_comeback', fired, confidence: fired ? confidenceOf(refs) : 0, refs, entryUsd, stopUsd, targetUsd, rr }
}

/**
 * Funding-source rule (operator mandate): "cek funding source ya, jangan
 * sampe 1 orang nyebar ke banyak wallet." A pair of checked-not-connected
 * buyers is evidence. Unknown pairs count as independent BUT each one
 * that had to be assumed caps the strategy's confidence.
 */
function independenceRefs(s: StructureContext, independence?: IndependenceContext): StrategyRefs[] {
  const refs: StrategyRefs[] = []
  const evidence = independence?.checked ?? []
  // Every unordered buyer pair is checked; a pair with no evidence is
  // ASSUMED independent and says so (operator: "cek funding source").
  for (let i = 0; i < s.buyers.length; i++) {
    for (let j = i + 1; j < s.buyers.length; j++) {
      const a = s.buyers[i]
      const b = s.buyers[j]
      const hit = evidence.find(
        (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
      )
      const label = `${a.slice(0, 6)}…/${b.slice(0, 6)}…`
      if (hit?.connected === true) {
        refs.push({
          rule: 'wallet-independence',
          passed: false,
          detail: `${label} CLUSTERED (conf ${hit.confidence ?? 'n/a'}) — one funder across wallets, not independent whales`,
        })
      } else if (hit?.connected === false) {
        refs.push({
          rule: 'wallet-independence',
          passed: true,
          detail: `${label} independent (verified, conf ${hit.confidence ?? 'n/a'})`,
        })
      } else {
        refs.push({
          rule: 'wallet-independence',
          passed: true,
          detail: `${label} independent (assumed — no cluster evidence)`,
        })
      }
    }
  }
  if (refs.length === 0) {
    refs.push({ rule: 'wallet-independence', passed: false, detail: 'fewer than 2 buyers — independence cannot be established' })
  }
  return refs
}

function confidenceOf(refs: StrategyRefs[]): number {
  const passed = refs.filter((r) => r.passed)
  const assumed = passed.filter((r) => r.detail.includes('assumed')).length
  const base = refs.length > 0 ? (passed.length / refs.length) * 60 : 0
  const bonus = allPassed(refs) ? 30 : 0
  return Math.max(0, Math.min(100, Math.round(base + bonus - assumed * 5)))
}

/** Minimum independent-buyer cap for Whale Comeback from IndependenceContext. */
export function minHolders(t: HolderContext, cfg: Partial<StrategyConfig> = {}): number | null {
  return t.trackedHolders !== null ? t.trackedHolders : clamp(cfg).minPriceGuardHolders
}

export const STRATEGY_LABELS = STRATEGY_NAMES
