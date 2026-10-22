// ─────────────────────────────────────────────────────────────
// MC structure — reads a market-cap series the way the operator reads
// a chart, in market-cap units (all three live strategies are quoted
// in MC: "base $3.6M–$4.4M", "resistance $10M", "peak $40M").
//
// Detects, from OHLCV-derived MC bars (see mc-series.ts):
//   · swing pivots (highs/lows) and whether the last two lows are
//     ASCENDING (higher low) or still printing new lows
//   · the consolidation base (range width + bar count)
//   · minor resistance above the base
//   · breakout close above that resistance
//   · a retest that held (price returned to the level and closed above)
//   · selling pressure trend (down-bar volume) and buy-volume return
//
// Every rule is a pure function of the bars. UNKNOWN is never a PASS:
// an under-specified series yields nulls, and the strategy evaluators
// refuse to fire on nulls rather than inventing a setup.
// ─────────────────────────────────────────────────────────────

export interface StructureBar {
  timeMs: number
  openUsd: number
  highUsd: number
  lowUsd: number
  closeUsd: number
  volumeUsd: number
}

export interface Pivot {
  /** 'high' = swing high (resistance candidate), 'low' = swing low. */
  kind: 'high' | 'low'
  timeMs: number
  priceUsd: number
  /** Bar index in the series. */
  index: number
}

export interface ConsolidationBase {
  lowUsd: number
  highUsd: number
  midUsd: number
  /** Width as a fraction of the low (0.2 = 20% range). */
  widthPct: number
  bars: number
  startMs: number
  endMs: number
}

export interface Breakout {
  levelUsd: number
  closeUsd: number
  /** How far above the level the close landed. */
  marginPct: number
  atMs: number
  index: number
}

export interface Retest {
  levelUsd: number
  held: boolean
  atMs: number
  /** Lowest low of the retest window, as a fraction below the level. */
  dipPct: number
}

export interface VolumeTrend {
  /** USD volume traded on down-closing bars, recent window. */
  downRecent: number
  /** USD volume traded on down-closing bars, prior window. */
  downPrior: number
  /**
   * recent/prior ratio. < 1 means selling pressure is FADING; > 1 means
   * sellers are getting stronger. null when the prior window is empty.
   */
  downRatio: number | null
  upRecent: number
  upPrior: number
  /** recent/prior ratio for buy volume; > 1 = buyers returning. */
  upRatio: number | null
}

export interface StructureConfig {
  /** Bars on each side required to call a swing pivot. */
  pivotWidth: number
  /** Look-back window for the consolidation base. */
  baseWindowBars: number
  /** Max base width (fraction of the low) to still count as a base. */
  maxBaseWidthPct: number
  /** Min bars inside the base window to call it consolidation. */
  minBaseBars: number
  /** Recent window (bars) used for "is it still printing new lows". */
  recentWindowBars: number
  /** Close must exceed resistance by this fraction to count as a breakout. */
  breakoutMarginPct: number
  /** Bars after the breakout inspected for a retest. */
  retestWindowBars: number
  /** A retest must not close below level × (1 − this) to count as held. */
  retestTolerancePct: number
  /** Volume trend compares the last N bars against the N before them. */
  volumeWindowBars: number
}

export const STRUCTURE_DEFAULTS: StructureConfig = {
  pivotWidth: 2,
  baseWindowBars: 24,
  maxBaseWidthPct: 0.4,
  minBaseBars: 10,
  recentWindowBars: 8,
  breakoutMarginPct: 0.02,
  retestWindowBars: 8,
  retestTolerancePct: 0.03,
  volumeWindowBars: 8,
}

export interface McStructure {
  /** Series length the summary was computed over. */
  bars: number
  /** Latest close (current MC). */
  currentMcUsd: number
  pivots: Pivot[]
  /** Last two swing lows, oldest first — the higher-low test. */
  lastLows: [Pivot, Pivot] | null
  /** True when the newest swing low is above the previous one. */
  higherLow: boolean
  /** True when recent bars printed a low at/below the prior window's low. */
  newLowRecently: boolean
  base: ConsolidationBase | null
  /** Highest swing high inside/above the base — the minor resistance. */
  minorResistanceUsd: number | null
  breakout: Breakout | null
  retest: Retest | null
  volume: VolumeTrend
  /** Peak MC seen in the series (the prior pump high). */
  seriesHighUsd: number
  /** Trough MC seen in the series. */
  seriesLowUsd: number
}

function clampConfig(c: Partial<StructureConfig> | undefined): StructureConfig {
  return { ...STRUCTURE_DEFAULTS, ...(c ?? {}) }
}

/** Swing pivots: a bar whose extreme beats `width` neighbours on each side. */
export function findPivots(bars: StructureBar[], width: number): Pivot[] {
  const out: Pivot[] = []
  if (bars.length < width * 2 + 1) return out
  for (let i = width; i < bars.length - width; i++) {
    const b = bars[i]
    let isHigh = true
    let isLow = true
    for (let j = i - width; j <= i + width; j++) {
      if (j === i) continue
      if (bars[j].highUsd >= b.highUsd) isHigh = false
      if (bars[j].lowUsd <= b.lowUsd) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) out.push({ kind: 'high', timeMs: b.timeMs, priceUsd: b.highUsd, index: i })
    else if (isLow) out.push({ kind: 'low', timeMs: b.timeMs, priceUsd: b.lowUsd, index: i })
  }
  return out
}

/**
 * Does the recent window still print lows at/below the prior window?
 * A genuine base must stop making new lows — otherwise it is still
 * bleeding and no "higher low" claim is honest.
 */
export function printsNewLows(bars: StructureBar[], window: number): boolean {
  if (bars.length < window * 2) return false
  const recent = bars.slice(-window)
  const prior = bars.slice(-window * 2, -window)
  const recentLow = Math.min(...recent.map((b) => b.lowUsd))
  const priorLow = Math.min(...prior.map((b) => b.lowUsd))
  return recentLow <= priorLow
}

/**
 * The consolidation range, or null if too wide to be a base.
 *
 * The base is searched BACK from `atIndex` (default: the series end). The
 * breakout window slices that end, so passing `bars.length -
 * breakoutWindowBars` reads the base off bars the breakout cannot be
 * inside. Reading both off the same trailing window made the two rules one
 * statement: a base that still contains the breakout bar caps its own
 * resistance, so "close above the range" could not be proven.
 */
export function findBase(
  bars: StructureBar[],
  cfg: StructureConfig,
  atIndex: number = bars.length,
): ConsolidationBase | null {
  const end = Math.max(0, Math.min(atIndex, bars.length))
  if (end < cfg.minBaseBars) return null
  const window = bars.slice(Math.max(0, end - cfg.baseWindowBars), end)
  const lowUsd = Math.min(...window.map((b) => b.lowUsd))
  const highUsd = Math.max(...window.map((b) => b.highUsd))
  if (!(lowUsd > 0) || !(highUsd > lowUsd)) return null
  const widthPct = (highUsd - lowUsd) / lowUsd
  if (widthPct > cfg.maxBaseWidthPct) return null
  return {
    lowUsd,
    highUsd,
    midUsd: (lowUsd + highUsd) / 2,
    widthPct,
    bars: window.length,
    startMs: window[0].timeMs,
    endMs: window[window.length - 1].timeMs,
  }
}

/**
 * Minor resistance: the highest swing high BELOW `atIndex` (the base
 * segment), falling back to the base's own high, then to the highest high
 * of that segment. A swing high inside the breakout window is not
 * resistance — the price already traded above it, so treating it as a
 * ceiling would let a bar "break out" above a level it just created.
 */
export function minorResistance(
  bars: StructureBar[],
  base: ConsolidationBase | null,
  pivots: Pivot[],
  cfg: StructureConfig,
  atIndex: number = bars.length,
): number | null {
  const end = Math.max(0, Math.min(atIndex, bars.length))
  const fromIndex = Math.max(0, end - cfg.baseWindowBars)
  const highs = pivots.filter((p) => p.kind === 'high' && p.index >= fromIndex && p.index < end)
  if (highs.length > 0) return Math.max(...highs.map((p) => p.priceUsd))
  if (base) return base.highUsd
  const window = bars.slice(fromIndex, end)
  return window.length > 0 ? Math.max(...window.map((b) => b.highUsd)) : null
}

/**
 * Breakout: the first bar AT OR AFTER `fromIndex` whose CLOSE exceeds
 * `level × (1 + margin)`. A wick above the level is not a breakout — the
 * operator's rule is "break & CLOSE above resistance".
 */
export function findBreakout(
  bars: StructureBar[],
  levelUsd: number | null,
  cfg: StructureConfig,
  fromIndex: number = Math.max(0, bars.length - cfg.baseWindowBars),
): Breakout | null {
  if (levelUsd === null || !(levelUsd > 0)) return null
  const threshold = levelUsd * (1 + cfg.breakoutMarginPct)
  const start = Math.max(0, Math.min(fromIndex, bars.length))
  for (let i = start; i < bars.length; i++) {
    const b = bars[i]
    if (b.closeUsd > threshold) {
      return {
        levelUsd,
        closeUsd: b.closeUsd,
        marginPct: b.closeUsd / levelUsd - 1,
        atMs: b.timeMs,
        index: i,
      }
    }
  }
  return null
}

/**
 * Retest: after the breakout bar, price returns to the level and closes
 * back above it. `dipPct` records how far below the level the wick went.
 */
export function findRetest(
  bars: StructureBar[],
  breakout: Breakout | null,
  cfg: StructureConfig,
): Retest | null {
  if (!breakout) return null
  const level = breakout.levelUsd
  const end = Math.min(bars.length, breakout.index + 1 + cfg.retestWindowBars)
  let visited = false
  let dipPct = 0
  let held = false
  let atMs = breakout.atMs
  for (let i = breakout.index + 1; i < end; i++) {
    const b = bars[i]
    if (b.lowUsd <= level * (1 + cfg.retestTolerancePct)) {
      visited = true
      dipPct = Math.min(dipPct, b.lowUsd / level - 1)
      // "Held" = the bar CLOSED back above the level. The operator's
      // failed-reclaim rule is "price balik masuk ke range", so a close
      // BELOW the level (even within proximity tolerance) is a failure,
      // not a hold.
      if (b.closeUsd > level) {
        held = true
        atMs = b.timeMs
        break
      }
    }
  }
  if (!visited) return null
  return { levelUsd: level, held, atMs, dipPct }
}

/** Down-bar vs up-bar volume over the last window, compared to the prior one. */
export function volumeTrend(
  bars: StructureBar[],
  window: number,
): VolumeTrend {
  const recent = bars.slice(-window)
  const prior = bars.slice(-window * 2, -window)
  const sum = (arr: StructureBar[], dir: 'up' | 'down') =>
    arr.reduce((acc, b) => {
      const up = b.closeUsd >= b.openUsd
      return acc + ((dir === 'up') === up ? b.volumeUsd : 0)
    }, 0)
  const downRecent = sum(recent, 'down')
  const downPrior = sum(prior, 'down')
  const upRecent = sum(recent, 'up')
  const upPrior = sum(prior, 'up')
  return {
    downRecent,
    downPrior,
    downRatio: downPrior > 0 ? downRecent / downPrior : null,
    upRecent,
    upPrior,
    upRatio: upPrior > 0 ? upRecent / upPrior : null,
  }
}

/** Full structure read for a series. Pure; never throws. */
export function analyzeStructure(
  bars: StructureBar[],
  config?: Partial<StructureConfig>,
): McStructure | null {
  const cfg = clampConfig(config)
  if (bars.length < cfg.minBaseBars) return null

  const pivots = findPivots(bars, cfg.pivotWidth)
  const lows = pivots.filter((p) => p.kind === 'low')
  const lastLows: [Pivot, Pivot] | null =
    lows.length >= 2 ? [lows[lows.length - 2], lows[lows.length - 1]] : null
  // Two swing lows give the cleanest answer. A steadily ascending base
  // often produces NO second pivot (each bar's low is the newest low), so
  // fall back to comparing the low of the recent half of the base window
  // against the prior half — that is the same claim ("the floor rose")
  // without requiring a pivot pattern that a smooth climb cannot make.
  const higherLow = lastLows !== null
    ? lastLows[1].priceUsd > lastLows[0].priceUsd
    : ((): boolean => {
        // A steadily ascending base often produces no second pivot; compare
        // the recent half's floor with the prior half's instead.
        const half = Math.max(2, Math.floor(cfg.recentWindowBars / 2))
        if (bars.length < half * 2) return false
        const recent = bars.slice(-half)
        const prior = bars.slice(-half * 2, -half)
        return Math.min(...recent.map((b) => b.lowUsd)) > Math.min(...prior.map((b) => b.lowUsd))
      })()

  // Two segments when the series has history BEFORE the breakout window:
  // the base (and its resistance) is read from bars that precede the
  // window, the breakout from inside it. Sharing one trailing window made
  // "range" and "left the range" the same statement, which no series can
  // satisfy. A series no longer than one window has no prior segment, so it
  // falls back to the single-window read (and the breakout stays unfound
  // unless price clears the top of everything visible).
  const breakoutFrom =
    bars.length <= cfg.baseWindowBars ? bars.length : bars.length - cfg.baseWindowBars
  const base = findBase(bars, cfg, breakoutFrom)
  const resistance = minorResistance(bars, base, pivots, cfg, breakoutFrom)
  const breakout = findBreakout(bars, resistance, cfg, breakoutFrom)
  const retest = findRetest(bars, breakout, cfg)
  const last = bars[bars.length - 1]

  return {
    bars: bars.length,
    currentMcUsd: last.closeUsd,
    pivots,
    lastLows,
    higherLow,
    newLowRecently: printsNewLows(bars, cfg.recentWindowBars),
    base,
    minorResistanceUsd: resistance,
    breakout,
    retest,
    volume: volumeTrend(bars, cfg.volumeWindowBars),
    seriesHighUsd: Math.max(...bars.map((b) => b.highUsd)),
    seriesLowUsd: Math.min(...bars.map((b) => b.lowUsd)),
  }
}
