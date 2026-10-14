// ─────────────────────────────────────────────────────────────
// Signal tier — the operator's quality gate (policy A–F).
//
// The evaluator answers "is this token safe + moving?" (SIGNAL /
// WATCHLIST / REJECT). This module answers the different question:
// "is this good enough to send as a TOP signal?"
//
// Tiers (policy D):
//   REJECT          — risk or a core criterion failed
//   UNKNOWN         — essential evidence missing
//   WATCHLIST       — interesting, unconfirmed
//   CANDIDATE       — passed screening, not yet a top signal
//   HIGH_CONVICTION — all mandatory gates passed + independent evidence
//   STALE           — data/signal expired
//
// Only HIGH_CONVICTION may be delivered as a top signal. WATCHLIST may be
// delivered only when the caller explicitly opts in, and must be labelled.
//
// SCOPE: this repo SCREENS. It never executes — execution belongs to
// 1ai-trade-dex. A HIGH_CONVICTION verdict is a published signal, not an
// order; the downstream executor decides and owns the order path.
// Pure — zero I/O.
// ─────────────────────────────────────────────────────────────

import type { SniperDecision } from './meme-sniper'
import type { SmartMoneyEvidence } from './smart-money-provider'

export const SIGNAL_TIERS = [
  'HIGH_CONVICTION',
  'CANDIDATE',
  'WATCHLIST',
  'UNKNOWN',
  'STALE',
  'REJECT',
] as const

export type SignalTier = (typeof SIGNAL_TIERS)[number]

export interface TierInput {
  decision: SniperDecision
  /** Wallet-DB evidence, or null when the provider was unavailable. */
  smartMoney: SmartMoneyEvidence | null
  /** Age of the token in minutes at evaluation time. */
  ageMinutes: number
  /** Max age (minutes) before a signal is considered stale for its stage. */
  staleAfterMinutes: number
  /** Whether the source data was complete (coverage.complete30d etc.). */
  dataComplete: boolean
}

export interface TierResult {
  tier: SignalTier
  /** Why this tier — always populated, for the decision record. */
  reasons: string[]
  /** Missing evidence that would raise the tier. */
  missing: string[]
  /** True only for HIGH_CONVICTION. */
  deliverableAsTopSignal: boolean
  /** True when WATCHLIST/CANDIDATE delivery is explicitly allowed. */
  deliverableAsWatchlist: boolean
}

/** Security gates whose failure is fatal regardless of upside. */
const SECURITY_MARKERS = ['mint', 'freeze', 'honeypot', 'lp', 'sellable'] as const

function isSecurityFailure(reason: string): boolean {
  const r = reason.toLowerCase()
  return SECURITY_MARKERS.some((m) => r.includes(m))
}

/**
 * Classify a decision into a tier.
 *
 * Ordering matters:
 *  1. REJECT beats everything — a security failure is never outranked by
 *     narrative, momentum, or a bullish wallet (policy C).
 *  2. STALE next — an expired signal is not evidence of anything.
 *  3. UNKNOWN when essential evidence is absent.
 *  4. HIGH_CONVICTION requires ALL of: clean screen, fresh data,
 *     independent smart-money confirmation with a real classified wallet.
 *  5. Otherwise CANDIDATE (screening passed) or WATCHLIST.
 */
export function classifySignalTier(input: TierInput): TierResult {
  const { decision, smartMoney, ageMinutes, staleAfterMinutes, dataComplete } = input
  const reasons: string[] = []
  const missing: string[] = []

  // 1. Hard reject — a security failure outranks every bullish signal.
  if (decision.status === 'REJECT') {
    const security = decision.rejections.filter(isSecurityFailure)
    reasons.push(
      security.length > 0
        ? `security failure: ${security[0]}`
        : `core criterion failed: ${decision.rejections[0] ?? 'unspecified'}`,
    )
    return { tier: 'REJECT', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: false }
  }

  // 2. Stale — never send expired data as if it were live.
  if (Number.isFinite(ageMinutes) && ageMinutes > staleAfterMinutes) {
    reasons.push(`signal age ${Math.round(ageMinutes)}m exceeds ${staleAfterMinutes}m freshness window`)
    return { tier: 'STALE', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: false }
  }

  // 3. Missing essential evidence -> never a pass by omission.
  if (!dataComplete) missing.push('source coverage incomplete')
  if (smartMoney === null) missing.push('wallet evidence unavailable')

  // 4. Independent confirmation: a real, fresh, classified buyer.
  const confirmedBuyers = smartMoney?.buyers.length ?? 0
  const hasStrongest = smartMoney?.strongest != null
  const confirmed = confirmedBuyers > 0 && hasStrongest

  if (!confirmed && confirmedBuyers === 0) {
    missing.push(
      smartMoney === null || smartMoney.walletsHolding === 0
        ? 'no classified wallet holds this token'
        : 'classified holders are not bullish or are stale',
    )
  }

  // 5. HIGH_CONVICTION only when nothing essential is missing.
  if (confirmed && missing.length === 0) {
    reasons.push(
      `clean screen at ${decision.metrics.volMcRatio.toFixed(2)}x volume`,
      `${confirmedBuyers} confirmed buyer(s), strongest=${smartMoney?.strongest}`,
    )
    return { tier: 'HIGH_CONVICTION', reasons, missing, deliverableAsTopSignal: true, deliverableAsWatchlist: true }
  }

  // 6. UNKNOWN when the evidence could not be read at all — absence
  // is not safety, and it sorts below "screened but unconfirmed".
  if (smartMoney === null) {
    reasons.push('wallet evidence could not be read — absence is not safety')
    return { tier: 'UNKNOWN', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: false }
  }

  // 7. Screening passed but evidence is incomplete -> CANDIDATE.
  if (decision.status === 'SIGNAL' && missing.length > 0) {
    reasons.push('screening passed but essential evidence is missing')
    return { tier: 'CANDIDATE', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: true }
  }

  reasons.push('interesting but unconfirmed')
  return { tier: 'WATCHLIST', reasons, missing, deliverableAsTopSignal: false, deliverableAsWatchlist: true }
}

export interface DeliveryPolicy {
  /** Send HIGH_CONVICTION as a top signal. */
  allowTopSignal: boolean
  /** Send WATCHLIST/CANDIDATE with an explicit non-top label. */
  allowWatchlist: boolean
}

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = {
  allowTopSignal: true,
  allowWatchlist: false, // policy D: watchlist is opt-in, never mixed in
}

/** Should this tier be delivered under the given policy? Pure. */
export function shouldDeliver(tier: SignalTier, policy: DeliveryPolicy = DEFAULT_DELIVERY_POLICY): boolean {
  if (tier === 'HIGH_CONVICTION') return policy.allowTopSignal
  if (tier === 'WATCHLIST' || tier === 'CANDIDATE') return policy.allowWatchlist
  return false // REJECT / UNKNOWN / STALE are never delivered
}

/** Label prefix so a non-top delivery can never be mistaken for one. Pure. */
export function tierLabel(tier: SignalTier): string {
  switch (tier) {
    case 'HIGH_CONVICTION':
      return 'HIGH-CONVICTION'
    case 'CANDIDATE':
      return 'CANDIDATE (not a top signal)'
    case 'WATCHLIST':
      return 'WATCHLIST (not a top signal)'
    case 'UNKNOWN':
      return 'UNKNOWN'
    case 'STALE':
      return 'STALE'
    case 'REJECT':
      return 'REJECT'
  }
}

// ─────────────────────────────────────────────────────────────
// Policy E — top-signal message format.
//
// A delivered top signal must carry: identity, stage, market facts with
// their source, security + distribution evidence, smart-money evidence
// with timing, the thesis, scenario targets with the valuation each one
// requires, the risks/invalidation, what is missing, and an explicit
// SHADOW MODE banner. Targets are arithmetic on market cap — never a
// promise of a realizable exit price.
// ─────────────────────────────────────────────────────────────

import type { SniperPayload } from './meme-sniper'

export interface SignalFormatInput {
  payload: SniperPayload
  tier: SignalTier
  tierReasons: string[]
  tierMissing: string[]
  smartMoney: SmartMoneyEvidence | null
  /** USD market cap used as the scenario base. Null disables targets. */
  marketCapUsd: number | null
  liquidityUsd?: number | null
  volumeUsd?: number | null
  /** Multiples to project. Defaults to 2/5/10. */
  multiples?: number[]
  /**
   * Which independent audits agreed on this token (rugged-proof,
   * rugcheck, ...). Correlation across sources is evidence; a single
   * source is a single point of failure and MUST read as one.
   */
  auditSources?: string[]
  /** Known risks / invalidation conditions, operator-facing. */
  risks?: string[]
  /** Attach inline BUY/chart buttons under the message. Defaults true. */
  sendButtons?: boolean
}

/**
 * Input for the CANDIDATE/WATCHLIST-tier "POTENTIAL COIN SIGNAL" message.
 * Intentionally NOT wired into delivery yet — wiring is a later,
 * operator-approved step (CANDIDATE stays opt-in watchlist).
 */
export interface PotentialCoinSignalInput {
  payload: SniperPayload
  tier: SignalTier
  tierReasons: string[]
  tierMissing: string[]
  smartMoney: SmartMoneyEvidence | null
  marketCapUsd: number | null
  liquidityUsd: number | null
  volumeUsd?: number | null
  /** Price change percent; null-safe rendered as n/a. */
  priceChangePct?: number | null
  risks?: string[]
  /** Verification timestamp; string/Date/epoch are all accepted, else n/a. */
  verifiedAt?: string | Date | number | null
  /** Attach inline BUY/chart buttons under the message. Defaults true. */
  sendButtons?: boolean
}

export interface ContractButtons {
  inline_keyboard: Array<Array<{ text: string; url: string }>>
}

export interface FormattedSignal {
  text: string
  replyMarkup: ContractButtons | undefined
}

/** Compact USD: $145.2K, $1.2M, $850. */
export function formatCompactUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  if (abs >= 1) return `${sign}$${Math.round(abs)}`
  if (abs === 0) return '$0'
  return `${sign}$${abs.toFixed(2)}`
}

function pct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 10) / 10}%` : 'n/a'
}

function verifiedAtLabel(v: string | Date | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'n/a'
  const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : v
  if (!Number.isFinite(ms)) return 'n/a'
  return new Date(ms).toISOString()
}

/** Per-check verdict for the evidence block. */
function potentialCheckVerdict(reason: string): 'PASS' | 'CAUTION' | 'FAIL' | 'UNKNOWN' {
  const r = reason.toLowerCase()
  if (r.includes('security failure') || r.includes('gagal') || r.includes('fail')) return 'FAIL'
  if (r.includes('warning') || r.includes('unconfirmed') || r.includes('belum terkonfirmasi') || r.includes('caution')) return 'CAUTION'
  if (r.includes('clean') || r.includes('bersih') || r.includes('confirmed') || r.includes('terverifikasi') || r.includes('pass')) return 'PASS'
  return 'UNKNOWN'
}

/**
 * Escape Telegram HTML control characters in dynamic text.
 *
 * The sniper transport sends parse_mode=HTML (see deliverSniperAlert). HTML
 * only reserves `&`, `<`, `>` — tickers/mints/reason strings can never open a
 * stray entity the way they do under legacy Markdown (`_` in `7tZt1LXb`).
 */
export function escapeSignalHtml(s: string | null | undefined): string {
  if (typeof s !== 'string') return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Tier badge with emoji for Telegram header. */
function tierBadge(tier: SignalTier): string {
  switch (tier) {
    case 'HIGH_CONVICTION':
      return '🟢 <b>HIGH-CONVICTION</b>'
    case 'CANDIDATE':
      return '🟡 <b>CANDIDATE</b>'
    case 'WATCHLIST':
      return '🟡 <b>WATCHLIST</b>'
    case 'UNKNOWN':
      return '⚪ <b>UNKNOWN</b>'
    case 'STALE':
      return '⚫ <b>STALE</b>'
    case 'REJECT':
      return '🔴 <b>REJECT</b>'
    default:
      return `⚪ <b>${escapeSignalHtml(tier)}</b>`
  }
}

/** Prominent Token Info block. */
function renderTokenInfo(payload: SniperPayload): string[] {
  const L: string[] = []
  const symbol = payload.ticker.startsWith('$') ? payload.ticker : `$${payload.ticker}`
  const nameStr = payload.name ? ` (${payload.name})` : ''
  L.push(`🪙 <b>Token:</b> ${escapeSignalHtml(symbol)}${escapeSignalHtml(nameStr)}`)
  L.push(`📋 <b>CA:</b> <code>${escapeSignalHtml(payload.contract)}</code> <i>(tap to copy)</i>`)

  const stageName = payload.stage === 'post-bonding' || payload.ageMinutes >= 120 ? 'Post-Bonding' : 'New Pair'
  const chainName = payload.chain ? (payload.chain.charAt(0).toUpperCase() + payload.chain.slice(1).toLowerCase()) : 'Solana'
  L.push(`⏱ <b>Stage:</b> ${stageName} (${payload.ageMinutes}m) | ⛓ <b>Chain:</b> ${escapeSignalHtml(chainName)}`)
  return L
}

/** Compact Market Metrics block. */
function renderMarketSection(
  marketCap: number | null | undefined,
  liquidity: number | null | undefined,
  volume5m: number | null | undefined,
  priceChangePct?: number | null | undefined,
): string[] {
  const L: string[] = []
  L.push('📊 <b>Market:</b>')

  const mcStr = formatCompactUsd(marketCap)
  const liqStr = formatCompactUsd(liquidity)
  L.push(`• Market Cap: <b>${mcStr}</b> | Liq: <b>${liqStr}</b>`)

  const volStr = formatCompactUsd(volume5m)
  const volMcRatio = volume5m != null && marketCap != null && marketCap > 0 ? volume5m / marketCap : null
  const ratioStr = volMcRatio != null ? `${volMcRatio.toFixed(1)}x` : null
  const flame = volMcRatio != null && volMcRatio >= 3 ? ' 🔥' : ''
  const ratioPart = ratioStr ? ` (Ratio: <b>${ratioStr}</b>${flame})` : ''

  const changePart = priceChangePct != null && Number.isFinite(priceChangePct)
    ? ` | 24h: <b>${priceChangePct > 0 ? '+' : ''}${Math.round(priceChangePct * 10) / 10}%</b>`
    : ''

  L.push(`• Vol 5m: <b>${volStr}</b>${ratioPart}${changePart}`)
  return L
}

/** Concise Safety Badges block. */
function renderSafetySection(
  sec: SniperPayload['security'],
  auditSources?: string[],
): string[] {
  const L: string[] = []
  L.push('🛡️ <b>Safety:</b>')

  const mint = sec.mintable === false ? '✅ OFF' : sec.mintable === true ? '🔴 ON' : '❓ N/A'
  const freeze = sec.freezeAuthority === false ? '✅ OFF' : sec.freezeAuthority ? '🔴 ON' : '❓ N/A'
  const honeypot = sec.honeypot === false ? '✅ PASS' : sec.honeypot === true ? '🔴 FAIL' : '❓ N/A'
  L.push(`• Mint: ${mint} | Freeze: ${freeze} | Honeypot: ${honeypot}`)

  let lpBadge: string
  const lpBurn = sec.lpBurnedPercent
  const lpLock = sec.lpLockedPercent
  if (lpBurn != null && lpBurn >= 99.5) {
    lpBadge = '🔥 100% Burnt (Rug-proof)'
  } else if (lpLock != null && lpLock >= 99.5) {
    lpBadge = '🔒 100% Locked (Rug-proof)'
  } else if ((lpBurn ?? 0) > 0 || (lpLock ?? 0) > 0) {
    lpBadge = `⚠️ Burn ${pct(lpBurn)} | Lock ${pct(lpLock)}`
  } else {
    lpBadge = '⚠️ LP Unlocked'
  }
  L.push(`• LP: ${lpBadge}`)

  if (auditSources && auditSources.length > 0) {
    if (auditSources.length >= 2) {
      L.push(`• Audits: ✅ ${auditSources.length} sources agreed (${escapeSignalHtml(auditSources.join(', '))})`)
    } else {
      L.push(`• Audits: ⚠️ 1 source only (${escapeSignalHtml(auditSources[0])}) — no cross-check`)
    }
  } else if (auditSources !== undefined) {
    L.push('• Audits: ⚠️ No confirmed audit sources')
  }

  return L
}

/** Compact Distribution block. */
function renderDistributionSection(dst: SniperPayload['distribution']): string[] {
  const L: string[] = []
  L.push('👥 <b>Distribution:</b>')

  let devStr = 'n/a'
  if (dst.devPercent !== null && dst.devPercent !== undefined) {
    devStr = dst.devPercent === 0 ? '0% (OUT)' : `${pct(dst.devPercent)} (⚠️ DEV IN)`
  }

  let top10Str = pct(dst.top10Percent)
  if (dst.top10Percent != null && dst.top10Percent > 30) {
    top10Str += ' ⚠️'
  }

  let sniperStr = pct(dst.sniperPercent)
  if (dst.sniperPercent != null && dst.sniperPercent > 6) {
    sniperStr += ' ⚠️'
  }

  L.push(`• Dev: ${devStr} | Top 10: ${top10Str} | Snipers: ${sniperStr}`)

  if (dst.bundlerPercent != null && dst.bundlerPercent > 5 && dst.bundlerSoldPercent !== 100) {
    L.push(`• ⚠️ Bundler holding ${pct(dst.bundlerPercent)}`)
  }
  if (dst.clusterPercent != null && dst.clusterPercent > 5) {
    L.push(`• ⚠️ Wallet cluster detected: ${pct(dst.clusterPercent)}`)
  }
  if (dst.insiderPercent != null && dst.insiderPercent > 5) {
    L.push(`• ⚠️ Insider holding ${pct(dst.insiderPercent)}`)
  }

  return L
}

/** Smart Money Inflow block. */
function renderSmartMoneySection(smartMoney: SmartMoneyEvidence | null): string[] {
  const L: string[] = []
  L.push('🧠 <b>Smart Money:</b>')

  const buyers = smartMoney?.buyers ?? []
  if (buyers.length > 0) {
    const count = buyers.length
    const first = buyers[0]
    const firstAlias = escapeSignalHtml(first.alias ?? `${first.address.slice(0, 4)}…${first.address.slice(-4)}`)

    if (count === 1) {
      L.push(`• 1 Classified Whale entered (${firstAlias})`)
    } else {
      const otherCount = count - 1
      const otherLabel = otherCount === 1 ? '1 other' : `${otherCount} others`
      L.push(`• ${count} Classified Whales entered (${firstAlias} + ${otherLabel})`)
    }

    if (first.winRate != null || first.pnl30d != null) {
      const wrStr = first.winRate != null ? `${Math.round(first.winRate * 100)}%` : 'n/a'
      const pnlStr = first.pnl30d != null ? `${first.pnl30d > 0 ? '+' : ''}${Math.round(first.pnl30d * 100)}%` : 'n/a'
      L.push(`   · Top Whale: ${firstAlias} (Win Rate: ${wrStr} | PnL: ${pnlStr})`)
    }
  } else {
    L.push('• No classified whales detected yet (Early stage)')
  }

  return L
}

/** Scenario Targets block. */
function renderTargetsSection(marketCapUsd: number | null | undefined, multiples?: number[]): string[] {
  const targets = scenarioTargets(marketCapUsd ?? null, multiples)
  if (targets.length === 0) return []
  const L: string[] = []
  L.push('🎯 <b>Targets (MCap Projection):</b>')
  const targetStr = targets.map((t) => `${t.multiple}x: <b>${formatCompactUsd(t.targetMcap)}</b>`).join(' | ')
  L.push(`• ${targetStr}`)
  L.push('   <i>Arithmetic projection, not guaranteed exit.</i>')
  return L
}

/** Highlights & checks block. */
function renderHighlightsSection(reasons: string[], missing: string[] = []): string[] {
  const L: string[] = []
  if (reasons.length > 0) {
    L.push('💡 <b>Key Highlights:</b>')
    for (const r of reasons) {
      const v = potentialCheckVerdict(r)
      const icon = v === 'FAIL' ? '🔴' : v === 'CAUTION' ? '⚠️' : '✅'
      L.push(`• ${icon} ${escapeSignalHtml(r)}`)
    }
  }
  if (missing.length > 0) {
    L.push('⚠️ <b>Unconfirmed Data:</b>')
    for (const m of missing) {
      L.push(`• ❓ ${escapeSignalHtml(m)}`)
    }
  }
  return L
}

/** Filtered Risks block. */
function renderRisksSection(risks?: string[]): string[] {
  if (!risks || risks.length === 0) return []
  const filtered = risks.filter(
    (r) => !r.toLowerCase().includes('tidak ada invalidation') && !r.toLowerCase().includes('none provided'),
  )
  if (filtered.length === 0) return []
  const L: string[] = []
  L.push('⚠️ <b>Risk Factors:</b>')
  for (const r of filtered) {
    L.push(`• ${escapeSignalHtml(r)}`)
  }
  return L
}

/**
 * Scenario targets. A multiple is arithmetic on market cap; it is NOT a
 * claim that the price is reachable or exitable at that valuation.
 */
export function scenarioTargets(
  marketCapUsd: number | null,
  multiples: number[] = [2, 5, 10],
): Array<{ multiple: number; targetMcap: number }> {
  if (marketCapUsd === null || !Number.isFinite(marketCapUsd) || marketCapUsd <= 0) return []
  return multiples.map((m) => ({ multiple: m, targetMcap: marketCapUsd * m }))
}

/**
 * Render the delivered message. Length-capped for Telegram (4096 chars).
 * Pure — zero I/O.
 */
export function formatTieredSignal(input: SignalFormatInput): FormattedSignal {
  const { payload, tier, tierReasons, tierMissing, smartMoney, marketCapUsd, risks } = input
  const sec = payload.security
  const dst = payload.distribution
  const mom = payload.momentum
  const L: string[] = []

  // Header with tier badge
  L.push(`⚡ <b>POTENTIAL COIN SIGNAL</b> · ${tierBadge(tier)}`)
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━')

  // Prominent Token info
  L.push(...renderTokenInfo(payload))
  L.push('')

  // Market
  const mc = marketCapUsd ?? mom.marketCap
  const vol = input.volumeUsd ?? mom.volume5m ?? null
  const liq = input.liquidityUsd ?? payload.liquidityUsd ?? null
  L.push(...renderMarketSection(mc, liq, vol))
  L.push('')

  // Safety
  L.push(...renderSafetySection(sec, input.auditSources))
  L.push('')

  // Distribution
  L.push(...renderDistributionSection(dst))
  L.push('')

  // Smart Money
  L.push(...renderSmartMoneySection(smartMoney))
  L.push('')

  // Targets (MCap Projection)
  const targetLines = renderTargetsSection(mc, input.multiples)
  if (targetLines.length > 0) {
    L.push(...targetLines)
    L.push('')
  }

  // Highlights
  const highlightLines = renderHighlightsSection(tierReasons, tierMissing)
  if (highlightLines.length > 0) {
    L.push(...highlightLines)
    L.push('')
  }

  // Risks
  const riskLines = renderRisksSection(risks)
  if (riskLines.length > 0) {
    L.push(...riskLines)
    L.push('')
  }

  // Footer
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━')
  L.push('🧷 <i>SHADOW (PAPER) — Output screening only, not financial advice</i>')

  const text = L.join('\n')
  const body = text.length > 4000 ? text.slice(0, 3990) + '\n…(truncated)' : text
  return {
    text: body,
    replyMarkup: input.sendButtons === false ? undefined : contractButtons(payload.contract, payload.chain),
  }
}

/**
 * CANDIDATE/WATCHLIST-tier message: named `POTENTIAL COIN SIGNAL`.
 *
 * Downstream rendering contract for candidate coins.
 */
export function formatPotentialCoinSignal(input: PotentialCoinSignalInput): FormattedSignal {
  const { payload, tier, tierReasons, tierMissing, smartMoney } = input
  const sec = payload.security
  const dst = payload.distribution
  const mom = payload.momentum
  const L: string[] = []

  // Header with tier badge
  L.push(`⚡ <b>POTENTIAL COIN SIGNAL</b> · ${tierBadge(tier)}`)
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━')

  // Prominent Token info
  L.push(...renderTokenInfo(payload))
  if (input.verifiedAt) {
    const vAt = verifiedAtLabel(input.verifiedAt)
    if (vAt !== 'n/a') {
      L.push(`🕒 <b>Verified at:</b> ${escapeSignalHtml(vAt)}`)
    }
  }
  L.push('')

  // Market
  const mc = input.marketCapUsd ?? mom.marketCap
  const vol = input.volumeUsd ?? mom.volume5m ?? null
  const liq = input.liquidityUsd ?? payload.liquidityUsd ?? null
  L.push(...renderMarketSection(mc, liq, vol, input.priceChangePct))
  L.push('')

  // Safety
  L.push(...renderSafetySection(sec))
  L.push('')

  // Distribution
  L.push(...renderDistributionSection(dst))
  L.push('')

  // Smart Money
  L.push(...renderSmartMoneySection(smartMoney))
  L.push('')

  // Targets (MCap Projection) if MC available
  const targetLines = renderTargetsSection(mc)
  if (targetLines.length > 0) {
    L.push(...targetLines)
    L.push('')
  }

  // Highlights
  const highlightLines = renderHighlightsSection(tierReasons, tierMissing)
  if (highlightLines.length > 0) {
    L.push(...highlightLines)
    L.push('')
  }

  // Risks
  const riskLines = renderRisksSection(input.risks)
  if (riskLines.length > 0) {
    L.push(...riskLines)
    L.push('')
  }

  // Footer
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━')
  L.push('🧷 <i>SHADOW (PAPER) — Output screening only, not financial advice</i>')

  const text = L.join('\n')
  const body = text.length > 4000 ? text.slice(0, 3990) + '\n…(truncated)' : text
  return {
    text: body,
    replyMarkup: input.sendButtons === false ? undefined : contractButtons(payload.contract, payload.chain),
  }
}

/**
 * Reason/missing strings originate in classifySignalTier (English, stable
 * phrasing) and in the evaluator's warnings. Translate the known templates
 * to Indonesian; pass anything unrecognized through verbatim (never invent a
 * translation that hides the original fact).
 */
/** Base58 mint shape: Solana mints are 32–44 alphanumeric base58 chars. */
const BASE58_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Chains this signal builder has real, provider-shaped link URLs for. */
const LINK_SUPPORTED_CHAINS: Record<string, true> = { solana: true }

export interface SignalLinkUrlValidation {
  /** Dexscreener chart URL (doubles as the chart link). Null when invalid. */
  chartUrl: string | null
  /**
   * Jupiter swap URL the builder actually emits. This repo SCREENS — it
   * never executes — so the Jupiter route is a link the operator can open,
   * never an order. Pump.fun mints route to the SOL-pair swap; everything
   * else routes to the generic USDC pair. Null only when validation fails.
   */
  swapUrl: string | null
  valid: boolean
  reason: string
}

/**
 * Validate the exact chart/swap URLs `contractButtons` would emit for a
 * mint. Pure — zero I/O. Deterministic: a valid non-pump Solana mint always
 * yields a chart URL and a Jupiter swap URL; a pump mint yields the SOL-pair
 * swap route. Both URLs carry the FULL validated mint (never a symbol).
 */
export function validateSignalLinkUrls(contract: string, chain?: string | null): SignalLinkUrlValidation {
  const supportedChain = LINK_SUPPORTED_CHAINS[chain ?? 'solana'] === true
  if (typeof contract !== 'string' || contract.length === 0) {
    return { chartUrl: null, swapUrl: null, valid: false, reason: 'contract is empty' }
  }
  if (!BASE58_MINT_RE.test(contract)) {
    return { chartUrl: null, swapUrl: null, valid: false, reason: 'contract is not a base58 mint' }
  }
  if (!supportedChain) {
    return { chartUrl: null, swapUrl: null, valid: false, reason: `unsupported chain: ${chain ?? 'null'}` }
  }
  const c = encodeURIComponent(contract)
  const chartUrl = `https://dexscreener.com/${chain ?? 'solana'}/${c}`
  const swapUrl = contract.endsWith('pump')
    ? `https://jup.ag/swap/SOL-${c}`
    : `https://jup.ag/swap/${c}-USDC`
  return { chartUrl, swapUrl, valid: true, reason: 'ok' }
}

/**
 * Inline trade buttons under a signal. Pure URL keyboard — Telegram renders
 * native tap buttons, no extra API surface. Dexscreener URL doubles as the
 * chart link; Axiom/Jupiter are the buy endpoints (pump = pump.fun mint,
 * else the generic Jupiter swap route).
 */
export function contractButtons(contract: string, chain?: string | null): ContractButtons {
  const v = validateSignalLinkUrls(contract, chain)
  if (!v.valid) return { inline_keyboard: [] }
  const c = encodeURIComponent(contract)
  const isPump = contract.endsWith('pump')
  const swapUrl = isPump ? `https://jup.ag/swap/SOL-${c}` : `https://jup.ag/swap/${c}-USDC`
  return {
    inline_keyboard: [
      [
        { text: '🟢 BUY Axiom', url: `https://axiom.trade/t/${c}` },
        { text: '⚡ BUY Jupiter', url: swapUrl },
      ],
      [
        { text: '📊 Dexscreener', url: v.chartUrl ?? '' },
        { text: '🔍 GMGN', url: `https://gmgn.ai/sol/token/${c}` },
      ],
    ],
  }
}

const REASON_ID: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^security failure: (.+)$/, (m) => `KEAMANAN GAGAL — ${m[1]}`],
  [/^core criterion failed: (.+)$/, (m) => `Kriteria inti gagal — ${m[1]}`],
  [/^signal age (\d+)m exceeds (\d+)m freshness window$/, (m) => `Usia sinyal ${m[1]}m melewati jendela kesegaran ${m[2]}m`],
  [/^clean screen at ([\d.]+)x volume$/, (m) => `Screening bersih di ${m[1]}x volume`],
  [/^(\d+) confirmed buyer\(s\), strongest=(.+)$/, (m) => `${m[1]} wallet terverifikasi, terkuat: ${m[2]}`],
  [/^wallet evidence unavailable$/, () => 'Bukti wallet tidak tersedia'],
  [/^wallet evidence could not be read — absence is not safety$/, () => 'Bukti wallet tidak terbaca — ketiadaan bukti bukan berarti aman'],
  [/^source coverage incomplete$/, () => 'Cakupan sumber tidak lengkap'],
  [/^no classified wallet holds this token$/, () => 'Tidak ada wallet terklasifikasi memegang token ini'],
  [/^classified holders are not bullish or are stale$/, () => 'Wallet terklasifikasi tidak bullish atau sudah kadaluwarsa'],
  [/^screening passed but essential evidence is missing$/, () => 'Screening lolos tapi bukti esensial masih hilang'],
  [/^interesting but unconfirmed$/, () => 'Menarik tapi belum terkonfirmasi'],
]

export function reasonId(s: string): string {
  for (const [re, fn] of REASON_ID) {
    const m = s.match(re)
    if (m) return fn(m)
  }
  return s
}

/**
 * Translate the evaluator's rejection templates to Indonesian for the
 * operator. Unmatched text passes through verbatim — a partial translation
 * must never hide which gate fired.
 */
export function rejectionId(s: string): string {
  let out = s
  out = out.replace(
    /^Dead momentum: 5m vol\/mcap ([\d.]+)x < required ([\d.]+)x$/,
    'Volume lemah — 5m vol/mcap $1x < syarat $2x',
  )
  out = out.replace(/^Top 10 hold ([\d.]+)% \(ceiling (\d+)%\)$/, 'Top 10 pegang $1% (batas $2%)')
  out = out.replace(
    /^Linked cluster unproven — cannot rule out coordinated wallets$/,
    'Cluster belum terbukti — wallet terkoordinasi belum bisa disingkirkan',
  )
  out = out.replace(/^Dev holds ([\d.]+)%(.*)$/, 'Dev pegang $1%$2')
  out = out.replace(/^Snipers hold ([\d.]+)%(.*)$/, 'Sniper pegang $1%$2')
  out = out.replace(/^Bundlers hold ([\d.]+)%(.*)$/, 'Bundler pegang $1%$2')
  out = out.replace(/^Insiders hold ([\d.]+)%(.*)$/, 'Insider pegang $1%$2')
  out = out.replace(/^Mint authority unproven \(must be disabled\)$/, 'Mint authority belum terbukti mati')
  out = out.replace(/^Freeze authority unproven \(must be disabled\)$/, 'Freeze authority belum terbukti mati')
  out = out.replace(
    /^Honeypot status unproven \(sell-side safety unknown\)$/,
    'Status honeypot belum terbukti — keamanan sisi jual tidak diketahui',
  )
  out = out.replace(
    /^LP burn\/lock unproven \(must be 100% burnt or locked\)$/,
    'LP burn/lock belum terbukti — harus 100% burnt atau locked',
  )
  out = out.replace(/^Top-10 concentration unproven$/, 'Konsentrasi top-10 belum terbukti')
  out = out.replace(/^Insider share unproven$/, 'Porsi insider belum terbukti')
  out = out.replace(/^Sniper share unproven$/, 'Porsi sniper belum terbukti')
  out = out.replace(/^Bundler share unproven$/, 'Porsi bundler belum terbukti')
  out = out.replace(/^Dev holding unproven \(must be 0%\)$/, 'Porsi dev belum terbukti (harus 0%)')
  out = out.replace(/^Market cap is zero\/unknown — ratio uncomputable$/, 'Market cap nol/tidak diketahui — ratio tidak bisa dihitung')
  out = out.replace(/^Volume unknown — momentum uncomputable$/, 'Volume tidak diketahui — momentum tidak bisa dihitung')
  return out
}
