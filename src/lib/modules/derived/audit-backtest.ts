// ─────────────────────────────────────────────────────────────
// Meme Sniper — audit backtest (read-only analytics).
//
// The audit trail records what the engine BELIEVED at evaluation time;
// Jupiter gives us what the market did afterwards. This module is the
// pure, unit-testable core of that measurement: it turns per-contract
// rows (entry market cap + current price) into summary rates.
//
// No I/O lives here — the script (`src/scripts/audit-backtest.ts`) owns
// reading data/sniper-audit.json, fetching prices, and writing the report.
// ─────────────────────────────────────────────────────────────

import { OUTCOME_DEFAULTS } from './sniper-outcomes'
import type { CriteriaProfileId } from './sniper-criteria'

export type BacktestOutcome = 'TARGET' | 'STOPPED' | 'FLAT'

export interface BacktestDistribution {
  devPercent: number | null
  sniperPercent: number | null
  bundlerPercent: number | null
  insiderPercent: number | null
  top10Percent: number | null
  clusterPercent: number | null
}

export interface BacktestRow {
  contract: string
  at: string
  status: string
  tier: string
  rejectionCount: number
  /** Entry market cap read from the audit entry (unit-price proxy). */
  entryMarketCapUsd: number
  /** Current Jupiter usdPrice, treated as the exit unit-price proxy. */
  currentPriceUsd: number | null
  /** (current - entry) / entry * 100. null when the exit side is unproven. */
  returnPct: number | null
  outcome: BacktestOutcome | null
  distribution: BacktestDistribution | null
  /** Criteria profile ids whose rejection bracket appears in the decision. */
  profileBreaches: string[]
}

/** Everything the script extracted for one unique contract before pricing. */
export interface BacktestRowInput {
  contract: string
  at: string
  status: string
  tier: string
  rejectionCount: number
  entryMarketCapUsd: number | null
  distribution: BacktestDistribution | null
  rejections: string[]
}

export interface BacktestBucket {
  count: number
  priced: number
  targets: number
  stops: number
  flats: number
  targetRate: number | null
  stopRate: number | null
  flatRate: number | null
}

export interface BacktestSummary {
  /** Rows selected for evaluation (unique contracts, entry MC proven). */
  totalEvaluated: number
  /** Rows that got a usable current price (denominator for all rates). */
  totalPriced: number
  targets: number
  stops: number
  flats: number
  /** TARGET / priced. null when priced is 0 — NEVER a fabricated 0%. */
  winRate: number | null
  stopRate: number | null
  flatRate: number | null
  /** Mean of returnPct over priced rows. null when priced is 0. */
  avgReturnPct: number | null
  /** Per-status bucket keyed by the audit entry's status. */
  byStatus: Record<string, BacktestBucket>
  /** Per-rejectionCount bucket: '0', '1', '2', '3+'. */
  byRejectionCount: Record<string, BacktestBucket>
  /** Per-profile bucket for any profileBreach seen. */
  byProfile: Record<string, BacktestBucket>
}

export const STATUS_BUCKET_KEYS = ['REJECT', 'WATCHLIST', 'SIGNAL'] as const

export const REJECTION_BUCKET_KEYS = ['0', '1', '2', '3+'] as const

export function emptyBucket(): BacktestBucket {
  return {
    count: 0,
    priced: 0,
    targets: 0,
    stops: 0,
    flats: 0,
    targetRate: null,
    stopRate: null,
    flatRate: null,
  }
}

function rate(n: number, denom: number): number | null {
  return denom > 0 ? n / denom : null
}

function finaliseBucket(bucket: BacktestBucket): BacktestBucket {
  return {
    ...bucket,
    targetRate: rate(bucket.targets, bucket.priced),
    stopRate: rate(bucket.stops, bucket.priced),
    flatRate: rate(bucket.flats, bucket.priced),
  }
}

function rejectionBucketKey(rejectionCount: number): string {
  if (rejectionCount >= 3) return '3+'
  return String(Math.max(0, rejectionCount))
}

/**
 * Reuse the outcome engine's bands — the same +100% / -50% an operator
 * sees on a delivered signal — rather than duplicating magic numbers.
 * Returns null when a usable price is missing (never a fabricated FLAT).
 */
export function classifyOutcome(
  entryMarketCapUsd: number,
  currentPriceUsd: number | null,
  config: { targetReturn: number; stopReturn: number } = OUTCOME_DEFAULTS,
): { returnPct: number | null; outcome: BacktestOutcome | null } {
  if (currentPriceUsd === null || !Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) {
    return { returnPct: null, outcome: null }
  }
  const returnPct = ((currentPriceUsd - entryMarketCapUsd) / entryMarketCapUsd) * 100
  if (returnPct >= config.targetReturn * 100) return { returnPct, outcome: 'TARGET' }
  if (returnPct <= config.stopReturn * 100) return { returnPct, outcome: 'STOPPED' }
  return { returnPct, outcome: 'FLAT' }
}

/**
 * Pure: derive the profile ids whose gates the engine actually failed.
 * Rejection strings look like "[golden-new-pairs] Single Whale …"; anything
 * without a bracket prefix (e.g. the operator's plain-English rejects) is
 * skipped — the per-profile slice only measures the named profiles.
 */
export function extractProfileBreaches(
  rejections: string[] | undefined,
  knownProfiles: readonly string[] = CRITERIA_PROFILE_IDS,
): string[] {
  if (!Array.isArray(rejections)) return []
  const seen: Record<string, true> = {}
  const breaches: string[] = []
  for (const rejection of rejections) {
    if (typeof rejection !== 'string') continue
    const match = /^\[([^\]]+)\]/.exec(rejection.trim())
    if (!match) continue
    const candidate = match[1]
    if (knownProfiles.includes(candidate) && seen[candidate] !== true) {
      seen[candidate] = true
      breaches.push(candidate)
    }
  }
  return breaches
}

/**
 * Pure row-builder used by the script and the tests: applies the outcome
 * bands and extracts the named profile breaches. The script skips inputs
 * with a null entry MC before calling this; the seam still prices any
 * proven entry (current price may be null, i.e. no forward data).
 */
export function buildBacktestRow(
  input: BacktestRowInput,
  currentPriceUsd: number | null,
  config: { targetReturn: number; stopReturn: number } = OUTCOME_DEFAULTS,
): BacktestRow {
  const entryMarketCapUsd = input.entryMarketCapUsd ?? 0
  const { returnPct, outcome } = classifyOutcome(entryMarketCapUsd, currentPriceUsd, config)
  return {
    contract: input.contract,
    at: input.at,
    status: input.status,
    tier: input.tier,
    rejectionCount: input.rejectionCount,
    entryMarketCapUsd,
    currentPriceUsd,
    returnPct,
    outcome,
    distribution: input.distribution,
    profileBreaches: extractProfileBreaches(input.rejections),
  }
}

/**
 * The single summary function the script (and the tests) rely on.
 *
 * Contract:
 *   • `totalEvaluated` counts every row handed in — those are already
 *     unique contracts with a proven entry market cap.
 *   • `totalPriced` counts rows whose `returnPct` is non-null; only those
 *     contribute to TARGET/STOPPED/FLAT rates and avgReturnPct.
 *   • Any rate with a zero denominator is null, never 0%.
 */
export function summariseBacktest(rows: BacktestRow[]): BacktestSummary {
  const priced = rows.filter((row) => row.returnPct !== null)

  const targets = priced.filter((row) => row.outcome === 'TARGET').length
  const stops = priced.filter((row) => row.outcome === 'STOPPED').length
  const flats = priced.filter((row) => row.outcome === 'FLAT').length

  const avgReturnPct =
    priced.length === 0
      ? null
      : priced.reduce((sum, row) => sum + (row.returnPct as number), 0) / priced.length

  const byStatus: Record<string, BacktestBucket> = {}
  for (const key of STATUS_BUCKET_KEYS) byStatus[key] = emptyBucket()
  const byRejectionCount: Record<string, BacktestBucket> = {}
  for (const key of REJECTION_BUCKET_KEYS) byRejectionCount[key] = emptyBucket()
  const byProfile: Record<string, BacktestBucket> = {}

  const bump = (bucket: BacktestBucket, row: BacktestRow, pricedRow: boolean): void => {
    bucket.count += 1
    if (!pricedRow) return
    bucket.priced += 1
    if (row.outcome === 'TARGET') bucket.targets += 1
    else if (row.outcome === 'STOPPED') bucket.stops += 1
    else if (row.outcome === 'FLAT') bucket.flats += 1
  }

  for (const row of rows) {
    const pricedRow = row.returnPct !== null
    const statusBucket = byStatus[row.status] ?? emptyBucket()
    bump(statusBucket, row, pricedRow)
    byStatus[row.status] = statusBucket

    const rejBucket = byRejectionCount[rejectionBucketKey(row.rejectionCount)]
    bump(rejBucket, row, pricedRow)

    for (const profile of row.profileBreaches) {
      const profileBucket = byProfile[profile] ?? emptyBucket()
      bump(profileBucket, row, pricedRow)
      byProfile[profile] = profileBucket
    }
  }

  return {
    totalEvaluated: rows.length,
    totalPriced: priced.length,
    targets,
    stops,
    flats,
    winRate: rate(targets, priced.length),
    stopRate: rate(stops, priced.length),
    flatRate: rate(flats, priced.length),
    avgReturnPct,
    byStatus: Object.fromEntries(Object.entries(byStatus).map(([k, b]) => [k, finaliseBucket(b)])),
    byRejectionCount: Object.fromEntries(
      Object.entries(byRejectionCount).map(([k, b]) => [k, finaliseBucket(b)]),
    ),
    byProfile: Object.fromEntries(Object.entries(byProfile).map(([k, b]) => [k, finaliseBucket(b)])),
  }
}

/** All five operator-documented profile ids — the valid bracket prefixes. */
export const CRITERIA_PROFILE_IDS = [
  'golden-new-pairs',
  'golden-post-migrated',
  'sniper-launch',
  'bonding-post',
  'exposure-early',
] as const satisfies readonly CriteriaProfileId[]
