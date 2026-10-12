// ─────────────────────────────────────────────────────────────
// Sniper review digest — full near-miss report for the operator only.
//
// Replaces the one-line digest: Phase 5 of the operator pipeline spec
// requires EVERY rejection (with actual value vs threshold), UNKNOWN
// verification status per metric, critical risks, and a final
// recommendation (REJECT / UNKNOWN / WATCHLIST / RE-EVALUATE).
// One contract per block, full contract, link buttons; digest may exceed
// 4096 chars → split into sequential messages, never truncated mid-token.
// Never throws; returns a sent/skipped receipt. Pure except the push.
//
// Unknown values render as UNKNOWN — never 0, never a bare 'n/a' that
// could be misread as a pass. Thresholds import from SNIPER_LIMITS.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deliverSniperAlert } from './meme-sniper'
import type { SniperScanDecision } from './sniper-scan'
import { escapeSignalHtml, rejectionId } from './signal-tier'
import { SNIPER_LIMITS } from './meme-sniper'

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
  } catch { /* dedupe state is best-effort */ }
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

// ─── Value-vs-threshold rows ─────────────────────────────────────

function vOrU(v: number | null | undefined, suffix = '%'): string {
  if (v == null || !Number.isFinite(v)) return 'UNKNOWN'
  return `${Math.round(v * 10) / 10}${suffix}`
}

function usdOrU(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'UNKNOWN'
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

/**
 * Every failed check as `label: aktual X vs batas Y`. The rejections array
 * already carries combined templates like "Snipers hold 14.6% (ceiling 6%)"
 * — each is translated but keeps its embedded numbers, and unknown-value
 * rows are flagged as UNPROVEN rather than treated as 0.
 */
function failedChecksBlock(d: SniperScanDecision): string[] {
  if (d.rejections.length === 0) return ['(tidak ada kegagalan tercatat — tidak konsisten dengan status REJECT)']
  return d.rejections.map((r) => `• ${escapeSignalHtml(rejectionId(r))}`)
}

function verified(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '❓ belum terverifikasi' : '✅ terverifikasi'
}

function smBlock(d: SniperScanDecision): string[] {
  const L: string[] = []
  if (d.smartMoneyBuyers > 0 && d.smartMoneyStrongest) {
    L.push(`Ditemukan: ${d.smartMoneyBuyers} wallet (${escapeSignalHtml(d.smartMoneyStrongest ?? '')})`)
  } else {
    L.push(`Tidak ada wallet terverifikasi memegang token ini (sumber: ${d.smartMoneySource ?? 'tidak tercatat'})`)
  }
  return L
}

// ─── Assessment ──────────────────────────────────────────────────

function isCriticalBreach(r: string): boolean {
  const l = r.toLowerCase()
  return (
    l.includes('honeypot') ||
    l.includes('mint authority enabled') ||
    l.includes('freeze authority enabled') ||
    l.includes('dev holds') && (Number(/[\d.]+/.exec(r)?.[0] ?? 0) > SNIPER_LIMITS.devHardCeilingPercent) ||
    l.includes('top wallet') // tainted top holder
  )
}

export interface ReviewAssessment {
  mainRisks: string[]
  unknowns: string[]
  whyNotSignal: string
  finalStatus: 'REJECT' | 'UNKNOWN' | 'WATCHLIST' | 'RE-EVALUATE'
  reevaluateReasons: string[]
}

export function assessReview(d: SniperScanDecision): ReviewAssessment {
  const m = d.metrics
  const mainRisks: string[] = []
  const unknowns: string[] = []

  const critical = d.rejections.filter(isCriticalBreach)
  if (critical.length > 0) mainRisks.push(`Kritis: ${rejectionId(critical[0])}`)
  if ((m.top10Percent ?? 0) >= SNIPER_LIMITS.top10Percent) {
    mainRisks.push(`Top 10 ${vOrU(m.top10Percent)} ≥ batas ${SNIPER_LIMITS.top10Percent}% — konsentrasi ekstrem`)
  }
  if (m.devPercent == null) unknowns.push('kepemilikan dev')
  if (m.insiderPercent == null) unknowns.push('porsi insider')
  if (m.clusterPercent == null) unknowns.push('linked cluster / bubblemap')
  if (m.sniperPercent == null) unknowns.push('porsi sniper')
  if ((d.market?.liquidityUsd ?? null) == null) unknowns.push('likuiditas (nilai LP aktual)')

  const securityUnproven =
    d.rejections.some((r) => /unproven/i.test(r)) || m.devPercent == null || m.insiderPercent == null
  const finalStatus: ReviewAssessment['finalStatus'] = critical.length > 0
    ? 'REJECT'
    : securityUnproven
      ? 'UNKNOWN'
      : m.volMcRatio >= 2
        ? 'RE-EVALUATE'
        : 'WATCHLIST'
  const reevaluateReasons: string[] = []
  if (finalStatus === 'RE-EVALUATE') {
    reevaluateReasons.push(`vol/mcap ${m.volMcRatio.toFixed(2)}x ≥ syarat 2x tetapi tidak ada breach kritis — layak dinilai ulang saat data segar`)
  }

  return {
    mainRisks: mainRisks.length > 0 ? mainRisks : ['(tidak ada risiko kritis teridentifikasi)'],
    unknowns: unknowns.length > 0 ? unknowns : ['(semua metrik utama terverifikasi)'],
    whyNotSignal: d.rejections.length > 0
      ? `${d.rejections.length} aturan keras gagal — hierarki teratas berlaku`
      : 'tidak konsisten: REJECT tanpa kegagalan tercatat',
    finalStatus,
    reevaluateReasons,
  }
}

// ─── Full token block (Phase 5 spec format) ──────────────────────

function tokenBlock(d: SniperScanDecision): string {
  const m = d.metrics
  const mk = d.market ?? { marketCapUsd: null, liquidityUsd: null, volume5mUsd: null, priceUsd: null }
  const ev = d.discoveryEvidence?.[0]
  const L: string[] = []

  L.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`)
  L.push(`<b>${escapeSignalHtml(d.ticker)} — ${escapeSignalHtml(d.contract.slice(0, 8))}…</b>`)
  L.push(`Mint: <code>${escapeSignalHtml(d.contract)}</code>`)
  L.push(`Sumber: ${escapeSignalHtml(ev?.provider ?? 'tak diketahui')}${d.discoveryCategory !== 'NEW_PAIRS' ? ` (${escapeSignalHtml(d.discoveryCategory)})` : ''}`)
  // Audit 2026-10-12: INFLUENCER is a raw channel label from call-feed
  // (kind='kol'), NOT verified influencer reach/attribution. Say so at the
  // render site so nobody reads it as a KOL-endorsement claim.
  if (d.discoveryCategory === 'INFLUENCER') {
    L.push(`Catatan: label INFLUENCER = tag channel call-feed, bukan verifikasi jangkauan/pengikut KOL`)
  }
  L.push(`Usia: ${escapeSignalHtml(m.ageLabel)}`)
  L.push(`Vol/MC: ${Number.isFinite(m.volMcRatio) ? m.volMcRatio.toFixed(2) + 'x' : 'UNKNOWN'}`)
  L.push(`Market cap: ${usdOrU(mk.marketCapUsd)} (${verified(mk.marketCapUsd as number | null)})`)
  L.push(`Liquidity: ${usdOrU(mk.liquidityUsd)} (${verified(mk.liquidityUsd as number | null)})`)
  L.push(`Top 10 holders: ${vOrU(m.top10Percent)} (${verified(m.top10Percent)})`)
  L.push(`Dev holding: ${vOrU(m.devPercent)} (${verified(m.devPercent)})`)
  L.push(`Sniper: ${vOrU(m.sniperPercent)} (${verified(m.sniperPercent)})`)
  L.push(`Insider: ${vOrU(m.insiderPercent)} (${verified(m.insiderPercent)})`)
  L.push(`Bundler/cluster: ${vOrU(m.clusterPercent ?? null)} (${verified(m.clusterPercent ?? null)})`)
  for (const line of smBlock(d)) L.push(`Smart money: ${line}`)
  L.push(`Whale activity: ${d.smartMoneyStrongest === 'WHALE' || d.smartMoneyStrongest === 'WHALE_AND_SMART_MONEY' ? `terdeteksi (${d.smartMoneyStrongest})` : 'tidak ada bukti whale terklasifikasi'}`)
  L.push(`Security: mint ${d.rejections.some((r) => r.startsWith('Mint authority')) ? '❓/🔴 bermasalah' : '✅ MATI terverifikasi'} · ` +
    `freeze ${d.rejections.some((r) => r.startsWith('Freeze authority')) ? '❓/🔴 bermasalah' : '✅ MATI terverifikasi'} · ` +
    `honeypot ${d.rejections.some((r) => r.startsWith('Honeypot')) ? '❓/🔴 perlu cek' : 'tidak ada flag'}`)
  L.push('')
  L.push(`<b>SEMUA ALASAN PENOLAKAN (${d.rejections.length}):</b>`)
  for (const line of failedChecksBlock(d)) L.push(line)
  if (d.warnings.length > 0) {
    L.push('')
    L.push(`<b>PERINGATAN (non-fatal):</b>`)
    for (const w of d.warnings) L.push(`• ${escapeSignalHtml(w)}`)
  }

  const a = assessReview(d)
  L.push('')
  L.push(`<b>ASSESSMENT:</b>`)
  L.push(`Risiko utama: ${escapeSignalHtml(a.mainRisks.join('; '))}`)
  L.push(`Data belum diketahui: ${escapeSignalHtml(a.unknowns.join(', '))}`)
  L.push(`Mengapa belum jadi sinyal: ${escapeSignalHtml(a.whyNotSignal)}`)
  L.push(`Status akhir: <b>${a.finalStatus}</b>`)
  if (a.reevaluateReasons.length > 0) L.push(`Alasan evaluasi ulang: ${escapeSignalHtml(a.reevaluateReasons.join('; '))}`)

  return L.join('\n')
}

// ─── Digest assembly (split, never truncated mid-token) ─────────

const TG_LIMIT = 4000

function splitBlocksIntoMessages(header: string, blocks: string[]): string[] {
  const msgs: string[] = []
  let cur = header
  for (const block of blocks) {
    if ((cur + '\n\n' + block).length > TG_LIMIT) {
      msgs.push(cur)
      cur = header + ' (lanjutan)\n\n' + block
    } else {
      cur += '\n\n' + block
    }
  }
  msgs.push(cur)
  return msgs
}

export interface ReviewDigestResult {
  candidates: number
  sent: boolean
  skipped: string | null
  /** Sequential message count (1 when everything fit). */
  messages?: number
}

/**
 * Push the digest to the review chat. Separate env from the sale channel:
 * SNIPER_REVIEW_CHAT_ID falls back to the operator's private chat, never
 * to the sale channel — a review digest must not leak into the product.
 * A REVIEW is never a signal: it cannot promote a candidate on its own
 * (see Phase 7 of the operator pipeline spec — separate module).
 */
export async function pushReviewDigest(
  decisions: SniperScanDecision[],


  opts: { scanAt?: string; limit?: number; forceContracts?: Set<string> } = {},
): Promise<ReviewDigestResult> {
  const picks = pickReviewCandidates(decisions)
  if (picks.length === 0) return { candidates: 0, sent: false, skipped: 'no near-miss' }
  const max = opts.limit ?? 10
  const shown = picks.slice(0, max)
  const seen = readReviewSeen()
  // A contract whose verdict/failures/market materially changed is re-reviewed
  // even inside the seen-TTL — that is the whole point of the audit trail.
  const force = opts.forceContracts ?? new Set<string>()
  const fresh = selectFreshForReview(shown, seen, force)
  if (fresh.length === 0) return { candidates: picks.length, sent: false, skipped: 'all seen' }
  const reviewedTotal = decisions.length
  const reReviewCount = fresh.filter((d) => force.has(d.contract)).length
  const header =
    `🔎 <b>VILONA — MANUAL REVIEW</b>\n` +
    `Kategori: REJECT-NEAR-PASS\n` +
    `Periode scan: ${escapeSignalHtml(opts.scanAt ?? new Date().toISOString())}\n` +
    `Kandidat: ${fresh.length} ditampilkan dari ${reviewedTotal} ditinjau` +
    (reReviewCount > 0 ? `\nEvaluasi ulang (perubahan material): ${reReviewCount}` : '')
  const blocks = fresh.map(tokenBlock)
  const messages = splitBlocksIntoMessages(header, blocks)

  const chat =
    process.env.SNIPER_REVIEW_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  if (!chat) return { candidates: fresh.length, sent: false, skipped: 'no review chat configured' }
  for (const text of messages) {
    const ok = await deliverSniperAlert(text, chat)
    if (!ok) return { candidates: fresh.length, sent: false, skipped: 'telegram rejected' }
  }
  const now = Date.now()
  for (const d of fresh) seen[d.contract] = now
  markReviewSeen(seen)
  return { candidates: fresh.length, sent: true, skipped: null, messages: messages.length }
}

/**
 * Which shown picks the digest actually sends: unseen contracts, plus any
 * contract the audit trail marked as materially changed (re-review inside
 * the seen-TTL). Pure so the rule is testable without Telegram.
 */
export function selectFreshForReview(
  shown: SniperScanDecision[],
  seen: Record<string, number>,
  force: Set<string> = new Set(),
): SniperScanDecision[] {
  return shown.filter((d) => force.has(d.contract) || seen[d.contract] === undefined)
}

/**
 * Pure render of the exact messages the review chat receives. Exposed for
 * receipt tests and for previewing a digest without sending to Telegram.
 */
export function renderReviewDigestForTest(
  decisions: SniperScanDecision[],
  opts: { scanAt?: string; limit?: number } = {},
): string[] {
  const picks = pickReviewCandidates(decisions).slice(0, opts.limit ?? 10)
  const header =
    `🔎 <b>VILONA — MANUAL REVIEW</b>\n` +
    `Kategori: REJECT-NEAR-PASS\n` +
    `Periode scan: ${escapeSignalHtml(opts.scanAt ?? new Date().toISOString())}\n` +
    `Kandidat: ${picks.length} ditampilkan dari ${decisions.length} ditinjau`
  return splitBlocksIntoMessages(header, picks.map(tokenBlock))
}
