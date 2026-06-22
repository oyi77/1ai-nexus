// ─────────────────────────────────────────────────────────────
// Correlation Engine — Cross-signal statistical analysis
// Computes Pearson r between paired on-chain / market signals
// sourceType: derived (no external call)
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
// ─── Types ───────────────────────────────────────────────────

export interface CorrelationResult {
  r: number
  pValue: number
  significance: 'significant' | 'inconclusive' | 'not_significant'
}

export interface CorrelationSnapshot {
  pair: string
  r: number
  pValue: number
  sampleSize: number
  lastUpdated: Date
}

interface SeriesPair {
  label: string
  series1: number[]
  series2: number[]
}

// ─── Ring Buffer Storage (in-memory) ─────────────────────────

const MAX_HISTORY = 200
const pairHistory: Map<string, SeriesPair> = new Map()
const snapshotCache: Map<string, CorrelationSnapshot> = new Map()
let initialised = false

// ─── Pearson Correlation ─────────────────────────────────────

/**
 * Calculate Pearson correlation coefficient and approximate p-value.
 *
 *   r = Σ((xi − x̄)(yi − ȳ)) / √(Σ(xi − x̄)² × Σ(yi − ȳ)²)
 *
 * Returns r ∈ [-1, 1] and a two-tailed p-value estimated via
 * the t-distribution with n − 2 degrees of freedom.
 */
export function calculateCorrelation(
  series1: number[],
  series2: number[],
): CorrelationResult {
  const n = Math.min(series1.length, series2.length)

  if (n < 3) {
    return { r: 0, pValue: 1, significance: 'inconclusive' }
  }

  // Means
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += series1[i]
    sumY += series2[i]
  }
  const meanX = sumX / n
  const meanY = sumY / n

  // Covariance and variances
  let covXY = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i++) {
    const dx = series1[i] - meanX
    const dy = series2[i] - meanY
    covXY += dx * dy
    varX += dx * dx
    varY += dy * dy
  }

  const denom = Math.sqrt(varX * varY)
  if (denom === 0) {
    return { r: 0, pValue: 1, significance: 'not_significant' }
  }

  const r = covXY / denom

  // t-statistic: t = r × √(n − 2) / √(1 − r²)
  const df = n - 2
  const rClamped = Math.max(-0.999999, Math.min(0.999999, r))
  const t = rClamped * Math.sqrt(df) / Math.sqrt(1 - rClamped * rClamped)

  // Approximate two-tailed p-value from t-distribution using
  // the regularised incomplete beta function (Abramowitz & Stegun 26.5.20)
  const pValue = twoTailedPValue(Math.abs(t), df)

  // Significance classification
  let significance: CorrelationResult['significance']
  if (pValue < 0.05) {
    significance = 'significant'
  } else if (pValue < 0.10) {
    significance = 'inconclusive'
  } else {
    significance = 'not_significant'
  }

  return { r, pValue, significance }
}

// ─── p-value helpers ─────────────────────────────────────────

/**
 * Two-tailed p-value from |t| and degrees of freedom via
 * the incomplete-beta regularised function.
 */
function twoTailedPValue(absT: number, df: number): number {
  const x = df / (df + absT * absT)
  const p = regularisedIncompleteBeta(df / 2, 0.5, x)
  return Math.min(1, Math.max(0, p))
}

/**
 * Regularised incomplete beta I_x(a, b) via continued fraction
 * (Lentz's method, Numerical Recipes §6.4).
 */
function regularisedIncompleteBeta(a: number, b: number, x: number): number {
  if (x < 0 || x > 1) return x <= 0 ? 0 : 1
  if (x === 0 || x === 1) return x

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b)
  const front = Math.exp(
    Math.log(x) * a + Math.log(1 - x) * b - lnBeta,
  ) / a

  // Use symmetry when x > (a+1)/(a+b+2) for faster convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularisedIncompleteBeta(b, a, 1 - x)
  }

  // Continued fraction (Lentz)
  const MAX_ITER = 200
  const EPS = 1e-14
  let f = 1
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < 1e-30) d = 1e-30
  d = 1 / d
  f = d

  for (let m = 1; m <= MAX_ITER; m++) {
    // Even step
    let numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    d = 1 + numerator * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + numerator / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    f *= c * d

    // Odd step
    numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + numerator * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + numerator / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const delta = c * d
    f *= delta

    if (Math.abs(delta - 1) < EPS) break
  }

  return front * f
}

/** Stirling-accurate log-gamma (Lanczos, Numerical Recipes §6.1). */
function lnGamma(z: number): number {
  const coeff = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -5.395239384953e-6,
  ]
  const x = z
  let y = z
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) {
    ser += coeff[j] / ++y
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

// ─── Public Correlation API ──────────────────────────────────

/** Return all cached correlation snapshots. */
export function getCorrelations(): CorrelationSnapshot[] {
  return Array.from(snapshotCache.values())
}

/**
 * Warm the in-memory snapshotCache from recent Prisma rows (last 24 h).
 * Safe to call multiple times — second+ calls are no-ops.
 * Never throws: DB errors are swallowed so the engine stays functional.
 */
export async function initCorrelations(): Promise<void> {
  if (initialised) return
  initialised = true

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const rows = await prisma.correlationSnapshot.findMany({
      where: { createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
    })

    // Keep only the most-recent row per pair label.
    for (const row of rows) {
      if (!snapshotCache.has(row.pair)) {
        snapshotCache.set(row.pair, {
          pair: row.pair,
          r: row.r,
          pValue: row.pValue,
          sampleSize: row.sampleSize,
          lastUpdated: row.createdAt,
        })
      }
    }
  } catch (err) {
    console.error('[correlation-engine] initCorrelations failed:', err)
  }
}

/**
 * Recalculate all predefined signal-pair correlations.
 * Feed time-series data through `feedPair()` first, then call this.
 *
 * Write-through: after updating the in-memory snapshotCache the new
 * snapshots are persisted to Prisma. DB errors are logged but never
 * propagate — the engine keeps working from memory alone.
 */
export async function updateCorrelations(): Promise<void> {
  await initCorrelations()

  const now = new Date()
  const newRows: { pair: string; r: number; pValue: number; sampleSize: number }[] = []

  for (const [key, pair] of pairHistory) {
    const result = calculateCorrelation(pair.series1, pair.series2)
    const sampleSize = Math.min(pair.series1.length, pair.series2.length)
    snapshotCache.set(key, {
      pair: pair.label,
      r: result.r,
      pValue: result.pValue,
      sampleSize,
      lastUpdated: now,
    })
    newRows.push({ pair: pair.label, r: result.r, pValue: result.pValue, sampleSize })
  }

  if (newRows.length > 0) {
    try {
      await prisma.correlationSnapshot.createMany({ data: newRows })
    } catch (err) {
      console.error('[correlation-engine] Prisma write failed:', err)
    }
  }
}

/**
 * Feed a new data point for a named signal pair.
 * The ring buffer trims to MAX_HISTORY automatically.
 */
export function feedPair(
  label: string,
  value1: number,
  value2: number,
): void {
  let entry = pairHistory.get(label)
  if (!entry) {
    entry = { label, series1: [], series2: [] }
    pairHistory.set(label, entry)
  }
  entry.series1.push(value1)
  entry.series2.push(value2)

  // Ring-buffer trim
  if (entry.series1.length > MAX_HISTORY) {
    entry.series1 = entry.series1.slice(-MAX_HISTORY)
    entry.series2 = entry.series2.slice(-MAX_HISTORY)
  }
}

/** Feed an entire series at once (useful for back-fill). */
export function feedPairBatch(
  label: string,
  series1: number[],
  series2: number[],
): void {
  const n = Math.min(series1.length, series2.length)
  for (let i = 0; i < n; i++) {
    feedPair(label, series1[i], series2[i])
  }
}

/** Clear all in-memory state (for testing). */
export function resetCorrelations(): void {
  pairHistory.clear()
  snapshotCache.clear()
  initialised = false
}

// ─── Pre-defined signal pair labels ──────────────────────────

export const SIGNAL_PAIRS = {
  WHALE_PRICE:       'whale_accumulation → 7d_price_change',
  SMART_MONEY_PRICE: 'smart_money_flow → price_direction',
  FUNDING_REVERSAL:  'funding_rate_extreme → price_reversal',
  DEX_WHALE:         'dex_volume_spike → whale_activity',
} as const
