// ─────────────────────────────────────────────────────────────
// Meme Sniper — real-time on-chain payload evaluator + Telegram alert.
//
// In:  a normalized on-chain payload (security / distribution / momentum)
//      from any upstream (Birdeye audit groups, RugCheck report, GMGN, or a
//      caller's own scraper).
// Out: a decision (EXECUTE / WATCHLIST / REJECT), the risk plan, and a
//      ready-to-send Telegram Markdown alert.
//
// Hard rules (any breach = REJECT):
//   mint authority off · freeze authority off · LP 100% burnt+locked
//   dev 0% · snipers <6% · bundlers <10% (<=30% only if 100% sold)
//   insiders <5% · top10 <30% · cluster <=5% · top1-3 not fresh/sniper/dev
//   new pair (<2h): 5m vol >= 2x mcap · post-bond: 5m vol >= 4x mcap
//
// UNKNOWN IS NOT SAFE: a `null` security field means the source could not
// prove it off, and an unprovable mint/freeze/LP is treated as a breach.
// A sniper that fires on missing data is an exit-liquidity donation.
//
// Zero upstream calls in `evaluateSniper`. The only I/O in this module is
// `deliverSniperAlert` (Telegram), which the route calls explicitly.
// ─────────────────────────────────────────────────────────────

export type SniperStage = 'new-pair' | 'post-bonding'

/** Wallet classification for the top-1..3 check. */
export type WalletKind = 'fresh' | 'sniper' | 'dev' | 'bundler' | 'insider' | 'holder' | 'unknown'

export interface SniperTopWallet {
  address: string
  percent: number
  kind: WalletKind
}

export interface SniperPayload {
  ticker: string
  contract: string
  chain?: string
  /** Explicit stage; derived from `ageMinutes` when omitted. */
  stage?: SniperStage
  ageMinutes: number
  security: {
    /** null = unproven. MUST be proven false. */
    mintable: boolean | null
    /** null = unproven. MUST be proven false. */
    freezeAuthority: boolean | null
    /** Percent of LP supply burnt (0..100). */
    lpBurnedPercent?: number | null
    /** Percent of LP supply locked (0..100). */
    lpLockedPercent?: number | null
    honeypot?: boolean | null
  }
  distribution: {
    /** Percent of supply held by the deployer. MUST be 0. */
    devPercent: number | null
    /** Percent bought in the launch block/seconds. */
    sniperPercent: number | null
    /** Percent held by wallets that bought the same block as the deployer. */
    bundlerPercent: number | null
    /** Percent of the bundler position already exited (0..100). */
    bundlerSoldPercent?: number | null
    insiderPercent: number | null
    /** Combined top-10 holder share. */
    top10Percent: number | null
    /** Largest linked-wallet cluster share. */
    clusterPercent?: number | null
    /** Top wallets, ordered by size. Only the first three are gated. */
    topWallets?: SniperTopWallet[]
  }
  momentum: {
    marketCap: number
    /** 5-minute volume in USD. */
    volume5m: number
    /** Average unrealized PnL across the top-5 holders, in percent. */
    top5AvgPnlPercent?: number | null
    narrative?: string
  }
}

export type SniperStatus = 'EXECUTE' | 'WATCHLIST' | 'REJECT'
export type PnlAssessment = 'dump-risk' | 'accumulation' | 'neutral'

export interface SniperMetrics {
  stage: SniperStage
  ageMinutes: number
  ageLabel: string
  stageLabel: string
  volMcRatio: number
  requiredRatio: number
  devPercent: number | null
  sniperPercent: number | null
  bundlerPercent: number | null
  insiderPercent: number | null
  top10Percent: number | null
  clusterPercent: number | null
  avgPnlPercent: number | null
  pnlAssessment: PnlAssessment
}

export interface SniperPlan {
  /** Clamped to the fixed degen band 5..20 USD. */
  sizeUsd: number
  stopLossPct: number
  slAmountUsd: number
  tp1Pct: number
  tp2Pct: number
}

export interface SniperDecision {
  status: SniperStatus
  rationale: string
  /** Every hard-rule breach found (empty when status is EXECUTE/WATCHLIST). */
  rejections: string[]
  /** Non-fatal observations (dump risk, marginal cluster). */
  warnings: string[]
  metrics: SniperMetrics
  plan: SniperPlan
  /** Ready-to-send Telegram Markdown. */
  alert: string
}

export const SNIPER_LIMITS = {
  devPercent: 0,
  devHardCeilingPercent: 2,
  sniperPercent: 6,
  bundlerPercent: 10,
  bundlerToleratedPercent: 30,
  insiderPercent: 5,
  top10Percent: 30,
  clusterPercent: 5,
  newPairVolMcRatio: 2,
  postBondingVolMcRatio: 4,
  dumpRiskPnlPercent: 150,
  accumulationPnlPercent: 50,
  stopLossPct: 70,
  tp1Pct: 100,
  tp2Pct: 400,
  minSizeUsd: 5,
  maxSizeUsd: 20,
  defaultSizeUsd: 10,
} as const

/** Consecutive stop-losses in one day before trading locks. */
export const MAX_CONSECUTIVE_STOP_LOSSES = 3

const L = SNIPER_LIMITS

function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? 'n/a' : `${Math.round(v * 10) / 10}`
}

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** Percent emoji: ideal → ✅, within tolerance → ⚠️, breach → 🔴. */
function gradeEmoji(value: number | null | undefined, idealAtMost: number, ceiling: number): string {
  if (value === null || value === undefined) return '🔴'
  if (value <= idealAtMost) return '✅'
  if (value < ceiling) return '⚠️'
  return '🔴'
}

/**
 * Escape Telegram legacy-Markdown control characters in dynamic text.
 * Per the Bot API only `_ * ` ` `[` are special; unbalanced ones make the
 * API reject the entire message with 400 — user-controlled tickers and
 * narratives must never be trusted raw. `]` and `)` are NOT special and
 * must stay unescaped (a stray backslash would render literally).
 */
export function escapeMd(s: string): string {
  return s.replace(/[_\*`\[]/g, '\\$&')
}

function deriveStage(payload: SniperPayload): SniperStage {
  if (payload.stage) return payload.stage
  return payload.ageMinutes < 120 ? 'new-pair' : 'post-bonding'
}

function ageLabel(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function assessPnl(avg: number | null | undefined): PnlAssessment {
  if (avg === null || avg === undefined) return 'neutral'
  if (avg > L.dumpRiskPnlPercent) return 'dump-risk'
  if (avg < L.accumulationPnlPercent) return 'accumulation'
  return 'neutral'
}

// ── Hard gates ────────────────────────────────────────────────

function securityBreaches(p: SniperPayload): string[] {
  const out: string[] = []
  const s = p.security

  if (s.mintable !== false) {
    out.push(
      s.mintable === null
        ? 'Mint authority unproven (must be disabled)'
        : 'Mint authority ENABLED — dev can inflate',
    )
  }
  if (s.freezeAuthority !== false) {
    out.push(
      s.freezeAuthority === null
        ? 'Freeze authority unproven (must be disabled)'
        : 'Freeze authority ENABLED — holders can be frozen',
    )
  }
  if (s.honeypot === true) out.push('Honeypot: sells are blocked')

  // Burnt+locked together must cover ~100% of LP. Either leg may be
  // unproven as long as the OTHER leg proves full coverage: 100% locked
  // is exit-safe even with burn unproven, and 100% burnt needs no lock
  // claim. Fully unproven stays a breach.
  const burned = s.lpBurnedPercent ?? 0
  const locked = s.lpLockedPercent ?? 0
  const lpKnown = s.lpBurnedPercent != null || s.lpLockedPercent != null
  if (!lpKnown) {
    out.push('LP burn/lock unproven (must be 100% burnt or locked)')
  } else if (burned + locked < 99.5) {
    out.push(`LP only ${fmtPct(burned + locked)}% burnt+locked — exit liquidity exposed`)
  }
  return out
}

function distributionBreaches(p: SniperPayload): string[] {
  const out: string[] = []
  const d = p.distribution

  if (d.devPercent === null || d.devPercent === undefined) out.push('Dev holding unproven (must be 0%)')
  else if (d.devPercent > L.devPercent) {
    out.push(
      d.devPercent < L.devHardCeilingPercent
        ? `Dev holds ${fmtPct(d.devPercent)}% (must be 0%; hard ceiling ${L.devHardCeilingPercent}%)`
        : `Dev holds ${fmtPct(d.devPercent)}% — beyond hard ceiling`,
    )
  }

  if (d.sniperPercent === null || d.sniperPercent === undefined) out.push('Sniper share unproven')
  else if (d.sniperPercent >= L.sniperPercent) {
    out.push(`Snipers hold ${fmtPct(d.sniperPercent)}% (ceiling ${L.sniperPercent}%)`)
  }

  if (d.bundlerPercent === null || d.bundlerPercent === undefined) out.push('Bundler share unproven')
  else if (d.bundlerPercent >= L.bundlerToleratedPercent) {
    out.push(`Bundlers hold ${fmtPct(d.bundlerPercent)}% — above tolerated max ${L.bundlerToleratedPercent}%`)
  } else if (d.bundlerPercent >= L.bundlerPercent && (d.bundlerSoldPercent ?? 0) < 100) {
    out.push(
      `Bundlers hold ${fmtPct(d.bundlerPercent)}% and have not fully exited (sold ${fmtPct(d.bundlerSoldPercent ?? 0)}%) — ceiling ${L.bundlerPercent}%`,
    )
  }

  if (d.insiderPercent === null || d.insiderPercent === undefined) out.push('Insider share unproven')
  else if (d.insiderPercent >= L.insiderPercent) {
    out.push(`Insiders hold ${fmtPct(d.insiderPercent)}% (ceiling ${L.insiderPercent}%)`)
  }

  if (d.top10Percent === null || d.top10Percent === undefined) out.push('Top-10 concentration unproven')
  else if (d.top10Percent >= L.top10Percent) {
    out.push(`Top 10 hold ${fmtPct(d.top10Percent)}% (ceiling ${L.top10Percent}%)`)
  }

  const cluster = d.clusterPercent ?? 0
  if (cluster > L.clusterPercent) {
    out.push(`Linked cluster holds ${fmtPct(cluster)}% (ceiling ${L.clusterPercent}%)`)
  }

  // Top 1-3 wallets must be broad holders — never fresh/sniper/dev distribution.
  const tainted: WalletKind[] = ['fresh', 'sniper', 'dev', 'bundler', 'insider']
  const top3 = (d.topWallets ?? []).slice(0, 3)
  const bad = top3.find((w) => tainted.includes(w.kind))
  if (bad) {
    out.push(
      `Top wallet ${bad.address.slice(0, 6)}… is a ${bad.kind} wallet (${fmtPct(bad.percent)}%) — not a clean holder`,
    )
  }
  return out
}

function momentumBreaches(p: SniperPayload, stage: SniperStage): { breaches: string[]; ratio: number } {
  const required = stage === 'new-pair' ? L.newPairVolMcRatio : L.postBondingVolMcRatio
  const mc = p.momentum.marketCap
  if (!(mc > 0)) return { breaches: ['Market cap is zero/unknown — ratio uncomputable'], ratio: 0 }
  const ratio = p.momentum.volume5m / mc
  const breaches: string[] = []
  if (ratio < required) {
    breaches.push(`Dead momentum: 5m vol/mcap ${ratio.toFixed(2)}x < required ${required}x`)
  }
  return { breaches, ratio }
}

// ── Alert ─────────────────────────────────────────────────────

function buildAlert(
  p: SniperPayload,
  status: SniperStatus,
  rationale: string,
  m: SniperMetrics,
  plan: SniperPlan,
): string {
  const s = p.security
  const mintStatus = s.mintable === false ? 'OFF ✅' : 'ON 🔴'
  const freezeStatus = s.freezeAuthority === false ? 'OFF ✅' : 'ON 🔴'
  const lpTotal = (s.lpBurnedPercent ?? 0) + (s.lpLockedPercent ?? 0)
  const lpStatus = lpTotal >= 99.5 ? '100% Burnt/Locked ✅' : `${fmtPct(lpTotal)}% 🔴`

  const pnlText = m.avgPnlPercent === null ? 'n/a' : `${m.avgPnlPercent > 0 ? '+' : ''}${fmtPct(m.avgPnlPercent)}`
  const narrative = p.momentum.narrative?.trim() || 'No catalyst data provided'

  return [
    '🎯 *VILONA MEME SNIPER — ALPHA ALERT*',
    '━━━━━━━━━━━━━━━━━━━━',
    `*Token:* ${escapeMd(p.ticker)} | \`${escapeMd(p.contract)}\``,
    `*Stage:* ${m.stageLabel} | *Age:* ${m.ageLabel}`,
    '',
    '📊 *AUDIT & ON-CHAIN INTEGRITY*',
    `• *Dev Holding:* ${fmtPct(m.devPercent)}% ${gradeEmoji(m.devPercent, 0, L.devHardCeilingPercent)}`,
    `• *Snipers:* ${fmtPct(m.sniperPercent)}% | *Bundlers:* ${fmtPct(m.bundlerPercent)}%`,
    `• *Insider:* ${fmtPct(m.insiderPercent)}% | *Top 10 Supply:* ${fmtPct(m.top10Percent)}%`,
    `• *Cluster Status:* ${fmtPct(m.clusterPercent)}% ${gradeEmoji(m.clusterPercent, 0, L.clusterPercent)}`,
    `• *LP & Security:* Mint ${mintStatus} | Freeze ${freezeStatus} | LP ${lpStatus}`,
    '',
    '📈 *MARKET DYNAMICS*',
    `• *Market Cap:* ${fmtUsd(p.momentum.marketCap)}`,
    `• *Volume:* ${fmtUsd(p.momentum.volume5m)} (*Ratio:* ${m.volMcRatio.toFixed(2)}x)`,
    `• *Top Holder Avg PnL:* ${pnlText}% (${m.pnlAssessment})`,
    `• *Narrative / Catalyst:* ${escapeMd(narrative)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `💡 *DECISION:* *[${status}]*`,
    `*Rationale:* ${escapeMd(rationale)}`,
    `*Setup:* Entry now | Stop Loss: -${plan.stopLossPct}% ($${plan.slAmountUsd.toFixed(2)}) | TP1: +${plan.tp1Pct}% (Free Ride)`,
  ].join('\n')
}

// ── Evaluator ─────────────────────────────────────────────────

export interface EvaluateOptions {
  /** When true, no snipe may be issued — the daily stop circuit is armed. */
  circuitLocked?: boolean
  /** Requested position size; clamped to the fixed degen band. */
  positionSizeUsd?: number
}

export function evaluateSniper(payload: SniperPayload, opts: EvaluateOptions = {}): SniperDecision {
  const stage = deriveStage(payload)
  const pnlAssessment = assessPnl(payload.momentum.top5AvgPnlPercent)

  const momentum = momentumBreaches(payload, stage)
  const rejections = [
    ...securityBreaches(payload),
    ...distributionBreaches(payload),
    ...momentum.breaches,
  ]

  const warnings: string[] = []
  if (pnlAssessment === 'dump-risk') {
    warnings.push(
      `Top holders average +${fmtPct(payload.momentum.top5AvgPnlPercent)}% unrealized — exit-liquidity risk, wait for a correction`,
    )
  }
  const cluster = payload.distribution.clusterPercent ?? 0
  if (cluster > 0 && cluster <= L.clusterPercent) {
    warnings.push(`Linked cluster holds ${fmtPct(cluster)}% — at the ceiling, size down`)
  }

  const metrics: SniperMetrics = {
    stage,
    ageMinutes: payload.ageMinutes,
    ageLabel: ageLabel(payload.ageMinutes),
    stageLabel: stage === 'new-pair' ? 'New Pair' : 'Post-Bonding',
    volMcRatio: momentum.ratio,
    requiredRatio: stage === 'new-pair' ? L.newPairVolMcRatio : L.postBondingVolMcRatio,
    devPercent: payload.distribution.devPercent,
    sniperPercent: payload.distribution.sniperPercent,
    bundlerPercent: payload.distribution.bundlerPercent,
    insiderPercent: payload.distribution.insiderPercent,
    top10Percent: payload.distribution.top10Percent,
    clusterPercent: payload.distribution.clusterPercent ?? null,
    avgPnlPercent: payload.momentum.top5AvgPnlPercent ?? null,
    pnlAssessment,
  }

  const requested = opts.positionSizeUsd ?? L.defaultSizeUsd
  const sizeUsd = Math.min(L.maxSizeUsd, Math.max(L.minSizeUsd, requested))
  const plan: SniperPlan = {
    sizeUsd,
    stopLossPct: L.stopLossPct,
    slAmountUsd: Math.round(sizeUsd * (L.stopLossPct / 100) * 100) / 100,
    tp1Pct: L.tp1Pct,
    tp2Pct: L.tp2Pct,
  }

  let status: SniperStatus
  let rationale: string

  if (rejections.length > 0) {
    status = 'REJECT'
    rationale =
      rejections.length === 1 ? rejections[0] : `${rejections.length} hard-rule breaches — ${rejections[0]}`
  } else if (opts.circuitLocked) {
    status = 'REJECT'
    rationale = `Daily stop circuit armed (${MAX_CONSECUTIVE_STOP_LOSSES} consecutive stop-losses) — trading locked until reset`
  } else if (pnlAssessment === 'dump-risk') {
    status = 'WATCHLIST'
    rationale = `Setup is clean and volume is live (${metrics.volMcRatio.toFixed(2)}x), but top holders sit on +${fmtPct(payload.momentum.top5AvgPnlPercent)}% — wait for the flush before entry`
  } else {
    status = 'EXECUTE'
    rationale =
      pnlAssessment === 'accumulation'
        ? `Clean distribution with top holders still accumulating (+${fmtPct(payload.momentum.top5AvgPnlPercent)}% avg PnL) and ${metrics.volMcRatio.toFixed(2)}x volume — asymmetry favors early entry`
        : `All hard filters passed with live ${metrics.volMcRatio.toFixed(2)}x volume and no concentrated exits — clean asymmetric entry`
  }

  return {
    status,
    rationale,
    rejections,
    warnings,
    metrics,
    plan,
    alert: buildAlert(payload, status, rationale, metrics, plan),
  }
}

// ── Telegram delivery ─────────────────────────────────────────

/**
 * Send an alert through the ecosystem's proven channel chain:
 * HUB_TELEGRAM_BOT_TOKEN → TELEGRAM_BOT_TOKEN, and
 * HUB_TELEGRAM_OWNER_CHAT_ID → TELEGRAM_ALERT_CHAT_ID → TELEGRAM_ADMIN_CHAT_ID.
 * Returns false (never throws) when unconfigured or the API rejects.
 */
export async function deliverSniperAlert(text: string, chatId?: string): Promise<boolean> {
  const token = process.env.HUB_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ''
  const chat =
    chatId ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ALERT_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  if (!token || !chat) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}
