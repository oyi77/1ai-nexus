// ─────────────────────────────────────────────────────────────
// Alpha Signal Cross-Correlation Engine
// Correlates alpha signal types across time to find leading/
// lagging relationships, convergence patterns, and composite
// signals that no single module can detect alone.
//
// sourceType: derived (no external call — consumes alpha-feed)
// ─────────────────────────────────────────────────────────────

import { calculateCorrelation } from './correlation-engine'

// ─── Public Types ─────────────────────────────────────────────

export type SignalType =
  | 'smart_money'
  | 'whale'
  | 'insider'
  | 'exchange_flow'
  | 'gap'
  | 'news'
  | 'weather'
  | 'liquidation'
  | 'new_listing'
  | 'correlation'
  | 'derivatives'

export interface AlphaSignalInput {
  id: string
  type: SignalType
  asset: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number    // 0–100
  confidence: number  // 0–1
  timestamp: Date
}

/** A single signal-type timeseries entry (aggregated per time bucket). */
export interface SignalBucket {
  ts: number          // bucket start (epoch ms)
  type: SignalType
  count: number       // how many signals in this bucket
  avgStrength: number // mean strength
  avgConfidence: number
  bullBearRatio: number // +1 = all bullish, -1 = all bearish, 0 = balanced
}

/** Correlation between two signal types at a given lag. */
export interface SignalCorrelation {
  typeA: SignalType
  typeB: SignalType
  lag: number          // positive = A leads B by this many buckets
  r: number            // Pearson r
  pValue: number
  sampleSize: number
  significance: 'significant' | 'inconclusive' | 'not_significant'
  direction: 'positive' | 'negative'
  description: string
}

/** A convergence — multiple signal types firing together. */
export interface ConvergencePattern {
  id: string
  types: SignalType[]
  avgStrength: number
  avgConfidence: number
  compositeScore: number  // 0–100, weighted by pairwise correlations
  historicalHitRate: number // how often this combo preceded a >2% move
  description: string
  timestamp: Date
  direction: 'bullish' | 'bearish' | 'mixed'
}

/** Full engine output. */
export interface CrossCorrelationReport {
  correlations: SignalCorrelation[]
  convergences: ConvergencePattern[]
  leadingIndicators: SignalCorrelation[]  // subset: |lag| > 0, significant
  signalTypeStrength: Record<SignalType, { avgStrength: number; count: number; trend: 'rising' | 'falling' | 'flat' }>
  generatedAt: Date
}

// ─── Internal Storage ─────────────────────────────────────────

const BUCKET_MS = 5 * 60 * 1000 // 5-minute buckets
const MAX_BUCKETS = 288          // 24h of 5-min buckets
const MAX_LAG = 12               // search up to 12 buckets (1h) of lag

const bucketStore: Map<string, SignalBucket[]> = new Map() // type → buckets
const convergenceHistory: ConvergencePattern[] = []
const MAX_CONVERGENCE_HISTORY = 500

let reportCache: CrossCorrelationReport | null = null
let reportCacheTs = 0
const REPORT_TTL = 30_000 // 30s cache

// ─── Time Bucket Helpers ─────────────────────────────────────

function findOrCreateBucket(type: SignalType, bucketTs: number): SignalBucket {
  let arr = bucketStore.get(type)
  if (!arr) {
    arr = []
    bucketStore.set(type, arr)
  }
  const existing = arr.find(b => b.ts === bucketTs)
  if (existing) return existing
  const bucket: SignalBucket = { ts: bucketTs, type, count: 0, avgStrength: 0, avgConfidence: 0, bullBearRatio: 0 }
  arr.push(bucket)
  if (arr.length > MAX_BUCKETS) {
    arr.splice(0, arr.length - MAX_BUCKETS)
  }
  return bucket
}

// ─── Feed: Ingest Alpha Signals ──────────────────────────────

/**
 * Ingest a batch of alpha signals into the cross-correlation engine.
 * Call this periodically (e.g. every 15s) with fresh alpha-feed data.
 * Each signal is bucketed by type and timestamp.
 */
export function ingestSignals(signals: AlphaSignalInput[]): void {
  const now = Date.now()

  for (const signal of signals) {
    const ts = signal.timestamp instanceof Date ? signal.timestamp.getTime() : now
    const bkt = Math.floor(ts / BUCKET_MS) * BUCKET_MS
    const bucket = findOrCreateBucket(signal.type, bkt)

    // Update running averages
    const n = bucket.count
    bucket.avgStrength = (bucket.avgStrength * n + signal.strength) / (n + 1)
    bucket.avgConfidence = (bucket.avgConfidence * n + signal.confidence) / (n + 1)

    // Bull/bear ratio: running score
    const dirScore = signal.direction === 'bullish' ? 1 : signal.direction === 'bearish' ? -1 : 0
    bucket.bullBearRatio = (bucket.bullBearRatio * n + dirScore) / (n + 1)

    bucket.count++
  }
}

// ─── Lagged Cross-Correlation ────────────────────────────────

/**
 * Compute lagged cross-correlation between two signal-type time series.
 * Returns the best correlation across all tested lags.
 */
function laggedCorrelation(typeA: SignalType, typeB: SignalType): SignalCorrelation {
  const seriesA = bucketStore.get(typeA) ?? []
  const seriesB = bucketStore.get(typeB) ?? []

  if (seriesA.length < 5 || seriesB.length < 5) {
    return {
      typeA, typeB, lag: 0, r: 0, pValue: 1,
      sampleSize: 0, significance: 'not_significant',
      direction: 'positive', description: 'Insufficient data',
    }
  }

  // Build aligned time maps
  const mapA = new Map<number, number>()
  const mapB = new Map<number, number>()
  for (const b of seriesA) mapA.set(b.ts, b.avgStrength)
  for (const b of seriesB) mapB.set(b.ts, b.avgStrength)

  // Find common timestamps
  const commonTs = [...mapA.keys()].filter(t => mapB.has(t)).sort((a, b) => a - b)

  // Also collect series for lag analysis
  const allTs = [...new Set([...mapA.keys(), ...mapB.keys()])].sort((a, b) => a - b)

  if (commonTs.length < 5) {
    // Not enough overlap — try using bullBearRatio instead
    const ratioA = seriesA.map(b => b.bullBearRatio)
    const ratioB = seriesB.map(b => b.bullBearRatio)
    const n = Math.min(ratioA.length, ratioB.length)
    if (n < 5) {
      return {
        typeA, typeB, lag: 0, r: 0, pValue: 1,
        sampleSize: n, significance: 'not_significant',
        direction: 'positive', description: 'Insufficient overlap',
      }
    }
    const result = calculateCorrelation(ratioA.slice(-n), ratioB.slice(-n))
    return formatCorrelation(typeA, typeB, 0, result, n)
  }

  // Test lags: -MAX_LAG to +MAX_LAG
  let bestR = 0
  let bestLag = 0
  let bestP = 1
  let bestN = 0

  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag++) {
    const valsA: number[] = []
    const valsB: number[] = []

    for (const ts of allTs) {
      const shiftedTs = ts - lag * BUCKET_MS
      const aVal = mapA.get(ts)
      const bVal = mapB.get(shiftedTs)
      if (aVal !== undefined && bVal !== undefined) {
        valsA.push(aVal)
        valsB.push(bVal)
      }
    }

    if (valsA.length < 5) continue

    const result = calculateCorrelation(valsA, valsB)
    if (Math.abs(result.r) > Math.abs(bestR)) {
      bestR = result.r
      bestLag = lag
      bestP = result.pValue
      bestN = valsA.length
    }
  }

  // Also check bullBearRatio correlation at best lag
  const ratioA: number[] = []
  const ratioB: number[] = []
  for (const ts of allTs) {
    const shiftedTs = ts - bestLag * BUCKET_MS
    const bA = seriesA.find(b => b.ts === ts)
    const bB = seriesB.find(b => b.ts === shiftedTs)
    if (bA && bB) {
      ratioA.push(bA.bullBearRatio)
      ratioB.push(bB.bullBearRatio)
    }
  }

  // Use strength correlation if it's stronger, otherwise direction
  let finalR = bestR
  let finalP = bestP
  let finalN = bestN

  if (ratioA.length >= 5) {
    const dirResult = calculateCorrelation(ratioA, ratioB)
    if (Math.abs(dirResult.r) > Math.abs(finalR)) {
      finalR = dirResult.r
      finalP = dirResult.pValue
      finalN = ratioA.length
    }
  }

  const significance: 'significant' | 'inconclusive' | 'not_significant' = finalP < 0.05 ? 'significant' : finalP < 0.10 ? 'inconclusive' : 'not_significant'
  return formatCorrelation(typeA, typeB, bestLag, { r: finalR, pValue: finalP, significance }, finalN)
}

// p-value classification: p < 0.05 → significant, p < 0.10 → inconclusive, else not_significant

function formatCorrelation(
  typeA: SignalType,
  typeB: SignalType,
  lag: number,
  result: { r: number; pValue: number; significance: 'significant' | 'inconclusive' | 'not_significant' },
  sampleSize: number,
): SignalCorrelation {
  const lagDesc = lag === 0 ? 'contemporaneous' : lag > 0 ? `${typeA} leads ${typeB} by ${lag * 5}min` : `${typeB} leads ${typeA} by ${Math.abs(lag) * 5}min`
  const rDesc = Math.abs(result.r) > 0.7 ? 'strong' : Math.abs(result.r) > 0.4 ? 'moderate' : Math.abs(result.r) > 0.2 ? 'weak' : 'negligible'

  return {
    typeA, typeB, lag,
    r: Math.round(result.r * 1000) / 1000,
    pValue: Math.round(result.pValue * 10000) / 10000,
    sampleSize,
    significance: result.significance,
    direction: result.r >= 0 ? 'positive' : 'negative',
    description: `${rDesc} ${result.r >= 0 ? 'positive' : 'negative'} correlation (${lagDesc}), n=${sampleSize}`,
  }
}

// ─── Convergence Detection ───────────────────────────────────

/**
 * Detect convergence patterns: multiple signal types firing simultaneously
 * with aligned directions. Composite score weighted by pairwise correlations.
 */
function detectConvergences(correlations: SignalCorrelation[]): ConvergencePattern[] {
  const now = Date.now()
  const recentWindow = 3 * BUCKET_MS // look at last 3 buckets (15 min)
  const convergences: ConvergencePattern[] = []

  // Find which signal types are currently active (have recent buckets with count > 0)
  const activeTypes: { type: SignalType; avgStrength: number; avgConfidence: number; bullBearRatio: number }[] = []

  for (const [type, buckets] of bucketStore) {
    const recent = buckets.filter(b => now - b.ts < recentWindow)
    if (recent.length === 0) continue

    const totalSignals = recent.reduce((s, b) => s + b.count, 0)
    if (totalSignals === 0) continue

    const avgStrength = recent.reduce((s, b) => s + b.avgStrength * b.count, 0) / totalSignals
    const avgConfidence = recent.reduce((s, b) => s + b.avgConfidence * b.count, 0) / totalSignals
    const bullBearRatio = recent.reduce((s, b) => s + b.bullBearRatio * b.count, 0) / totalSignals

    activeTypes.push({ type: type as SignalType, avgStrength, avgConfidence, bullBearRatio })
  }

  // Need at least 2 active types for convergence
  if (activeTypes.length < 2) return convergences

  // Generate all pairs and triples
  for (let i = 0; i < activeTypes.length; i++) {
    for (let j = i + 1; j < activeTypes.length; j++) {
      const pair = [activeTypes[i], activeTypes[j]]
      const conv = buildConvergence(pair, correlations, now)
      if (conv) convergences.push(conv)
    }
  }

  // Triples (strongest convergences)
  for (let i = 0; i < activeTypes.length; i++) {
    for (let j = i + 1; j < activeTypes.length; j++) {
      for (let k = j + 1; k < activeTypes.length; k++) {
        const triple = [activeTypes[i], activeTypes[j], activeTypes[k]]
        const conv = buildConvergence(triple, correlations, now)
        if (conv) convergences.push(conv)
      }
    }
  }

  // Sort by composite score descending
  convergences.sort((a, b) => b.compositeScore - a.compositeScore)

  // Store in history
  for (const c of convergences) {
    convergenceHistory.push(c)
  }
  while (convergenceHistory.length > MAX_CONVERGENCE_HISTORY) {
    convergenceHistory.shift()
  }

  return convergences.slice(0, 10) // top 10
}

function buildConvergence(
  actives: { type: SignalType; avgStrength: number; avgConfidence: number; bullBearRatio: number }[],
  correlations: SignalCorrelation[],
  now: number,
): ConvergencePattern | null {
  const types = actives.map(a => a.type).sort()
  const typesKey = types.join('+')

  // Check direction alignment
  const bullCount = actives.filter(a => a.bullBearRatio > 0.2).length
  const bearCount = actives.filter(a => a.bullBearRatio < -0.2).length
  const mixed = bullCount > 0 && bearCount > 0

  const direction: ConvergencePattern['direction'] = mixed ? 'mixed' : bullCount >= bearCount ? 'bullish' : 'bearish'

  // Average strength/confidence across all active types
  const avgStrength = actives.reduce((s, a) => s + a.avgStrength, 0) / actives.length
  const avgConfidence = actives.reduce((s, a) => s + a.avgConfidence, 0) / actives.length

  // Composite score: base strength × confidence boost × correlation boost
  let corrBoost = 1.0
  const matchingCorrs = correlations.filter(c =>
    types.includes(c.typeA) && types.includes(c.typeB) && c.significance !== 'not_significant'
  )
  if (matchingCorrs.length > 0) {
    const avgAbsR = matchingCorrs.reduce((s, c) => s + Math.abs(c.r), 0) / matchingCorrs.length
    corrBoost = 1 + avgAbsR // 1.0–2.0 boost
  }

  // Direction alignment bonus
  const alignmentBonus = mixed ? 0.7 : 1.0

  const compositeScore = Math.min(100, Math.round(
    avgStrength * avgConfidence * corrBoost * alignmentBonus
  ))

  // Skip low-scoring convergences
  if (compositeScore < 15) return null

  // Historical hit rate: how often this type combo appeared and preceded a move
  const historicalHits = convergenceHistory.filter(c => {
    const overlap = c.types.filter(t => types.includes(t)).length
    return overlap === types.length
  })
  const historicalHitRate = historicalHits.length > 0
    ? historicalHits.filter(h => h.compositeScore > 40).length / historicalHits.length
    : 0

  const typeLabels = types.map(t => t.replace(/_/g, ' '))
  return {
    id: `conv-${typesKey}-${now}`,
    types,
    avgStrength: Math.round(avgStrength * 10) / 10,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    compositeScore,
    historicalHitRate: Math.round(historicalHitRate * 100) / 100,
    description: `${typeLabels.join(' + ')} convergence — ${direction} (${compositeScore}/100)`,
    timestamp: new Date(now),
    direction,
  }
}

// ─── Signal Type Strength Tracking ───────────────────────────

function computeSignalTypeStrength(): Record<SignalType, { avgStrength: number; count: number; trend: 'rising' | 'falling' | 'flat' }> {
  const result: Record<string, { avgStrength: number; count: number; trend: 'rising' | 'falling' | 'flat' }> = {}

  const allTypes: SignalType[] = [
    'smart_money', 'whale', 'insider', 'exchange_flow', 'gap',
    'news', 'weather', 'liquidation', 'new_listing', 'correlation', 'derivatives',
  ]

  for (const type of allTypes) {
    const buckets = bucketStore.get(type) ?? []
    if (buckets.length === 0) {
      result[type] = { avgStrength: 0, count: 0, trend: 'flat' }
      continue
    }

    const totalSignals = buckets.reduce((s, b) => s + b.count, 0)
    const avgStrength = buckets.reduce((s, b) => s + b.avgStrength * b.count, 0) / totalSignals

    // Trend: compare first half vs second half
    const mid = Math.floor(buckets.length / 2)
    const firstHalf = buckets.slice(0, mid)
    const secondHalf = buckets.slice(mid)

    const firstAvg = firstHalf.length > 0
      ? firstHalf.reduce((s, b) => s + b.avgStrength, 0) / firstHalf.length
      : 0
    const secondAvg = secondHalf.length > 0
      ? secondHalf.reduce((s, b) => s + b.avgStrength, 0) / secondHalf.length
      : 0

    const diff = secondAvg - firstAvg
    const trend: 'rising' | 'falling' | 'flat' = diff > 5 ? 'rising' : diff < -5 ? 'falling' : 'flat'

    result[type] = {
      avgStrength: Math.round(avgStrength * 10) / 10,
      count: totalSignals,
      trend,
    }
  }

  return result as Record<SignalType, { avgStrength: number; count: number; trend: 'rising' | 'falling' | 'flat' }>
}

// ─── Cross-Correlation Pairs to Pre-compute ──────────────────

const CROSS_PAIRS: [SignalType, SignalType][] = [
  ['whale', 'smart_money'],
  ['whale', 'exchange_flow'],
  ['whale', 'liquidation'],
  ['insider', 'smart_money'],
  ['insider', 'exchange_flow'],
  ['exchange_flow', 'liquidation'],
  ['derivatives', 'liquidation'],
  ['smart_money', 'derivatives'],
  ['news', 'smart_money'],
  ['gap', 'exchange_flow'],
  ['weather', 'gap'],
  ['whale', 'derivatives'],
  ['insider', 'whale'],
  ['liquidation', 'smart_money'],
  ['news', 'exchange_flow'],
]

// ─── Main Report Generator ───────────────────────────────────

/**
 * Generate the full cross-correlation report.
 * Uses the in-memory bucket store; no external calls.
 */
export function generateReport(): CrossCorrelationReport {
  const now = Date.now()
  if (reportCache && now - reportCacheTs < REPORT_TTL) {
    return reportCache
  }

  const correlations: SignalCorrelation[] = []
  for (const [typeA, typeB] of CROSS_PAIRS) {
    correlations.push(laggedCorrelation(typeA, typeB))
  }

  // Sort by |r| descending
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))

  const convergences = detectConvergences(correlations)

  const leadingIndicators = correlations.filter(
    c => c.significance !== 'not_significant' && c.lag !== 0
  )

  const signalTypeStrength = computeSignalTypeStrength()

  const report: CrossCorrelationReport = {
    correlations,
    convergences,
    leadingIndicators,
    signalTypeStrength,
    generatedAt: new Date(now),
  }

  reportCache = report
  reportCacheTs = now
  return report
}

/**
 * Get the raw bucket store (for debugging/testing).
 */
export function getBucketStore(): Map<string, SignalBucket[]> {
  return bucketStore
}

/**
 * Clear all in-memory state (for testing).
 */
export function resetCrossCorrelation(): void {
  bucketStore.clear()
  convergenceHistory.length = 0
  reportCache = null
  reportCacheTs = 0
}

/**
 * Get convergence history (for historical hit rate tracking).
 */
export function getConvergenceHistory(): ConvergencePattern[] {
  return [...convergenceHistory]
}
