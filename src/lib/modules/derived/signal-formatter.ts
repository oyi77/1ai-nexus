// ─────────────────────────────────────────────────────────────
// Policy E — top-signal message format.
//
// A delivered top signal must carry: identity, stage, market facts with
// their source, security + distribution evidence, smart-money evidence
// with timing, the thesis, scenario targets with the valuation each one
// requires, the risks/invalidation, what is missing, and an explicit
// SHADOW MODE banner. Targets are arithmetic on market cap — never a
// promise of a realizable exit price.
//
// Carved from signal-tier.ts for the 800-line gate.
// ─────────────────────────────────────────────────────────────

import type { SniperPayload } from './meme-sniper'
import type { DevHistoryVerdict } from '@/lib/modules/derived/dev-history'
import {
  BULLISH_STATUSES,
  TRACER_PNL_STATUS,
  type SmartMoneyEvidence,
  type WalletBuyer,
} from './smart-money-provider'
import type { SignalTier } from './signal-tier-classify'
import type { ContractButtons } from './signal-buttons'
import { contractButtons } from './signal-buttons'

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
  /** Developer history classification (anti-rug lifecycle). */
  devHistory?: DevHistoryVerdict | null
  /** Bonding curve progress & lifecycle state (Solpump trenches / PumpFun). */
  bondingCurve?: { progressPct: number; state?: string } | null
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
  auditSources?: string[]
  devHistory?: DevHistoryVerdict | null
  bondingCurve?: { progressPct: number; state?: string } | null
  risks?: string[]
  /** Verification timestamp; string/Date/epoch are all accepted, else n/a. */
  verifiedAt?: string | Date | number | null
  /** Attach inline BUY/chart buttons under the message. Defaults true. */
  sendButtons?: boolean
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
  devHistory?: DevHistoryVerdict | null,
  bondingCurve?: { progressPct: number; state?: string } | null,
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

  if (devHistory) {
    if (devHistory.tier === 'CLEAN') {
      L.push(`• Dev History: ✅ CLEAN (${devHistory.migrations}/${devHistory.previousTokens} migrated)`)
    } else if (devHistory.tier === 'UNPROVEN') {
      L.push('• Dev History: ℹ️ UNPROVEN (first deploy)')
    } else if (devHistory.tier === 'SUSPECT') {
      const rate = Math.round((devHistory.migrationRate ?? 0) * 100)
      L.push(`• Dev History: ⚠️ SUSPECT (${devHistory.migrations}/${devHistory.previousTokens} migrated, rate ${rate}%)`)
    } else if (devHistory.tier === 'SERIAL_RUGGER') {
      L.push(`• Dev History: 🚨 SERIAL RUGGER (${devHistory.ruggedCount} rugged / ${devHistory.previousTokens} deployed)`)
    }
  }

  if (bondingCurve) {
    const stateLabel = escapeSignalHtml(bondingCurve.state || 'Graduating')
    L.push(`• Bonding Curve: 🚀 ${bondingCurve.progressPct.toFixed(1)}% (${stateLabel})`)
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

/**
 * Render the smart-money block.
 *
 * Two populations arrive in `buyers` and they are NOT interchangeable:
 *   · BULLISH_STATUSES - a classified track record (whale / qualified smart
 *     money). Only these may be called a classified whale.
 *   · TRACER_PNL - a holder with positive realized PnL on THIS token only
 *     (single sample, no win rate). Calling that a classified whale is the
 *     exact confusion the classifier hardening exists to prevent, so it is
 *     rendered as an unqualified line and can never become "Top Whale".
 */
function renderSmartMoneySection(smartMoney: SmartMoneyEvidence | null): string[] {
  const L: string[] = []
  L.push('🧠 <b>Smart Money:</b>')

  const buyers = smartMoney?.buyers ?? []
  const classified = buyers.filter((b) =>
    (BULLISH_STATUSES as readonly string[]).includes(b.status ?? ''),
  )
  const unqualified = buyers.filter((b) => !(BULLISH_STATUSES as readonly string[]).includes(b.status ?? ''))

  if (classified.length > 0) {
    const first = classified[0]
    const firstAlias = buyerAlias(first)
    const count = classified.length
    if (count === 1) {
      L.push(`• 1 Classified Whale entered (${firstAlias})`)
    } else {
      const otherCount = count - 1
      const otherLabel = otherCount === 1 ? '1 other' : `${otherCount} others`
      L.push(`• ${count} Classified Whales entered (${firstAlias} + ${otherLabel})`)
    }

    const wrStr = first.winRate != null ? `${Math.round(first.winRate * 100)}%` : 'n/a'
    const pnlStr = first.pnl30d != null ? `${first.pnl30d > 0 ? '+' : ''}${Math.round(first.pnl30d * 100)}%` : 'n/a'
    L.push(`   · Top Whale: ${firstAlias} (Win Rate: ${wrStr} | PnL: ${pnlStr})`)
  }

  if (unqualified.length > 0) {
    const first = unqualified[0]
    const firstAlias = buyerAlias(first)
    const count = unqualified.length
    const noun = count === 1 ? 'holder' : 'holders'
    const pnlStr = first.pnl30d != null ? `${first.pnl30d > 0 ? '+' : ''}${Math.round(first.pnl30d * 100)}%` : 'n/a'
    const tracerOnly = unqualified.every((b) => b.status === TRACER_PNL_STATUS)
    if (tracerOnly) {
      L.push(
        `• ${count} profitable ${noun} on this token (${firstAlias}) — <i>no wallet track record: single-token PnL ${pnlStr}, sample ${first.sampleCount}, win rate n/a</i>`,
      )
    } else {
      L.push(
        `• ${count} unclassified ${noun} holding (${firstAlias}) — <i>status not qualified, not counted as smart money</i>`,
      )
    }
  }

  if (classified.length === 0 && unqualified.length === 0) {
    L.push('• No classified whales detected yet (Early stage)')
  }

  return L
}

/** Short, escaped display name for a buyer row. */
function buyerAlias(b: WalletBuyer): string {
  return escapeSignalHtml(b.alias ?? `${b.address.slice(0, 4)}…${b.address.slice(-4)}`)
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
  L.push(
    tier === 'HIGH_CONVICTION'
      ? `🚀 <b>HIGH CONVICTION SIGNAL</b> · ${tierBadge(tier)}`
      : `⚡ <b>POTENTIAL COIN SIGNAL</b> · ${tierBadge(tier)}`,
  )
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
  L.push(...renderSafetySection(sec, input.auditSources, input.devHistory, input.bondingCurve))
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
  L.push(...renderSafetySection(sec, input.auditSources, input.devHistory, input.bondingCurve))
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
