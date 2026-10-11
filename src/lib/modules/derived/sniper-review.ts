// ─────────────────────────────────────────────────────────────
// Sniper review digest — near-miss REJECTs for the operator's eyes only.
//
// The sale channel takes HIGH_CONVICTION only (rare by design). This
// digest surfaces REJECTs that cleared half the momentum gate
// (volMcRatio ≥ 0.5x vs the 2x requirement) to a PRIVATE review chat so
// the operator can eyeball and manually forward the deserving ones.
//
// Deliberately NOT a signal format: one compact line per token, no
// targets, no thesis, no tier label that could be mistaken for a call.
// Never throws; returns a sent/skipped receipt. Pure except the push.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deliverSniperAlert } from './meme-sniper'
import type { SniperScanDecision } from './sniper-scan'
import { escapeSignalMd } from './signal-tier'

/** Floor as a fraction of the new-pair 2x gate: quarter-way there. */
export const REVIEW_VOLMC_FLOOR = Number(process.env.SNIPER_REVIEW_VOLMC_FLOOR) || 0.5

function reviewSeenPath(): string {
  return process.env.SNIPER_REVIEW_SEEN_PATH || join(process.cwd(), 'data', 'sniper-review-seen.json')
}

function reviewSeenTtlMs(): number {
  return Number(process.env.SNIPER_REVIEW_SEEN_TTL_MS) || 6 * 60 * 60_000
}

function readReviewSeen(): Record<string, number> {
  try {
    const p = reviewSeenPath()
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, number>
    const cutoff = Date.now() - reviewSeenTtlMs()
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) if (v >= cutoff) out[k] = v
    return out
  } catch {
    return {}
  }
}

function markReviewSeen(map: Record<string, number>): void {
  try {
    const p = reviewSeenPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(map))
  } catch {
    /* dedupe state is best-effort */
  }
}

/** Near-miss = REJECT that still showed real 5m flow. Sorted hottest first. */
export function pickReviewCandidates(decisions: SniperScanDecision[]): SniperScanDecision[] {
  return decisions
    .filter(
      (d) =>
        d.status === 'REJECT' &&
        !d.deduped &&
        Number.isFinite(d.metrics.volMcRatio) &&
        d.metrics.volMcRatio >= REVIEW_VOLMC_FLOOR,
    )
    .sort((a, b) => b.metrics.volMcRatio - a.metrics.volMcRatio)
}

function oneLine(d: SniperScanDecision): string {
  const m = d.metrics
  const top = m.top10Percent != null ? `${Math.round(m.top10Percent * 10) / 10}%` : 'n/a'
  const firstBreach = (d.rejections[0] ?? 'no reason').slice(0, 90)
  const sm =
    d.smartMoneyBuyers > 0
      ? `${d.smartMoneyBuyers}(${escapeSignalMd(d.smartMoneyStrongest ?? '?')})`
      : 'none'
  const head =
    `- ${escapeSignalMd(d.ticker)} | ${m.volMcRatio.toFixed(2)}x | ${escapeSignalMd(m.ageLabel)} ` +
    `| top10 ${escapeSignalMd(top)} | sm=${sm}`
  const tail = `  ${escapeSignalMd(d.contract.slice(0, 12))}.. - ${escapeSignalMd(firstBreach)}`
  return `${head}\n${tail}`
}

export interface ReviewDigestResult {
  candidates: number
  sent: boolean
  skipped: string | null
}

/**
 * Push the digest to the review chat. Separate env from the sale channel:
 * SNIPER_REVIEW_CHAT_ID falls back to the operator's private chat, never
 * to the sale channel — a review digest must not leak into the product.
 */
export async function pushReviewDigest(decisions: SniperScanDecision[]): Promise<ReviewDigestResult> {
  const picks = pickReviewCandidates(decisions)
  if (picks.length === 0) return { candidates: 0, sent: false, skipped: 'no near-miss' }
  const seen = readReviewSeen()
  const fresh = picks.filter((d) => seen[d.contract] === undefined)
  if (fresh.length === 0) return { candidates: picks.length, sent: false, skipped: 'all seen' }

  const lines = fresh.map(oneLine)
  const text =
    `*REVIEW — near-miss rejects (not signals)*\n` +
    `${fresh.length} token(s) ≥ ${REVIEW_VOLMC_FLOOR}x vol/mcap, rejected on other grounds. Eyeball, forward manually if deserved.\n\n` +
    lines.join('\n')
  const chat =
    process.env.SNIPER_REVIEW_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  if (!chat) return { candidates: picks.length, sent: false, skipped: 'no review chat configured' }
  const ok = await deliverSniperAlert(text, chat)
  if (ok) {
    const now = Date.now()
    for (const d of fresh) seen[d.contract] = now
    markReviewSeen(seen)
  }
  return { candidates: picks.length, sent: ok, skipped: ok ? null : 'telegram rejected' }
}
