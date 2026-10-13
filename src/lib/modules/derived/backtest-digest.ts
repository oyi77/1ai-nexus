// ─────────────────────────────────────────────────────────────
// Meme Sniper — audit backtest Telegram digest.
//
// Turns the persisted audit-backtest report (`data/audit-backtest-report.json`)
// into a single compact HTML message for the operator. Pure: the caller owns
// I/O and sending; this module only maps a report → text (or null when there
// is nothing worth sending).
// ─────────────────────────────────────────────────────────────

import { escapeSignalHtml } from './signal-tier'

/** A single status/level bucket inside the summary (tolerant shape). */
export interface BacktestDigestBucket {
  count?: number
  priced?: number
  /** TARGET / priced as a fraction (e.g. 0.25 = 25%). null when unpriced. */
  targetRate?: number | null
}

/** The summary keys the digest reads (optional → tolerant of older reports). */
export interface BacktestDigestSummary {
  totalEvaluated?: number
  totalPriced?: number
  /** TARGET / priced as a fraction. null when priced is 0. */
  winRate?: number | null
  /** STOPPED / priced as a fraction. null when priced is 0. */
  stopRate?: number | null
  /** Mean return in percent. null when priced is 0. */
  avgReturnPct?: number | null
  byStatus?: Record<string, BacktestDigestBucket>
}

/**
 * The report shape the script writes — the digest only reads a few keys and
 * is deliberately tolerant of older files (any field may be missing).
 */
export interface BacktestReport {
  generatedAt?: string
  evaluated?: number
  priced?: number
  summary?: BacktestDigestSummary
}

/** Fraction (0..1) → percent with one decimal; null → 'n/a'. */
function ratePct(rate: number | null | undefined): string {
  return typeof rate === 'number' && Number.isFinite(rate) ? `${(rate * 100).toFixed(1)}%` : 'n/a'
}

/** Signed percent with one decimal; null → 'n/a'. */
function returnPct(avg: number | null | undefined): string {
  if (typeof avg !== 'number' || !Number.isFinite(avg)) return 'n/a'
  return `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}%`
}

/**
 * Build the one-block Telegram HTML digest, or null when there is nothing
 * to price (priced === 0) or the summary is missing entirely.
 */
export function buildBacktestDigest(report: BacktestReport): string | null {
  const summary = report.summary
  if (!summary) return null

  const priced =
    typeof report.priced === 'number' && Number.isFinite(report.priced)
      ? report.priced
      : typeof summary.totalPriced === 'number'
        ? summary.totalPriced
        : 0
  if (priced <= 0) return null

  const evaluated =
    typeof report.evaluated === 'number' ? report.evaluated : summary.totalEvaluated ?? 0

  const lines: string[] = [
    '📊 <b>AUDIT BACKTEST</b>',
    `Evaluated: ${evaluated} · Priced: ${priced}`,
    `Win rate: ${ratePct(summary.winRate)} · Stop rate: ${ratePct(summary.stopRate)} · Avg return: ${returnPct(summary.avgReturnPct)}`,
  ]

  for (const [status, bucket] of Object.entries(summary.byStatus ?? {})) {
    const bucketPriced = typeof bucket.priced === 'number' ? bucket.priced : 0
    lines.push(
      `<b>${escapeSignalHtml(status)}</b>: ${bucketPriced} priced · target ${ratePct(bucket.targetRate)}`,
    )
  }

  lines.push('shadow/paper analytics')

  const text = lines.join('\n')
  return text.length < 2000 ? text : `${text.slice(0, 1990)}…`
}
