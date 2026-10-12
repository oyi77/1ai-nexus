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
  /** Multiples to project. Defaults to 2/5/10. */
  multiples?: number[]
  /** Known risks / invalidation conditions, operator-facing. */
  risks?: string[]
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



/** Compact USD: $1.2M, $340K, $950. */
function usd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a'
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function pct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 10) / 10}%` : 'n/a'
}

/** Escape Telegram legacy-Markdown control characters in dynamic text. */
export function escapeSignalMd(s: string): string {
  return s.replace(/[_*`\[]/g, '\\$&')
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

  // Header dengan emoji tier yang jelas
  const TIER_EMOJI: Record<SignalTier, string> = {
    HIGH_CONVICTION: '🟢 HIGH-CONVICTION',
    CANDIDATE: '🟡 CANDIDATE (bukan sinyal utama)',
    WATCHLIST: '🟡 WATCHLIST (bukan sinyal utama)',
    UNKNOWN: '⚪ UNKNOWN',
    STALE: '⚫ STALE (kedaluwarsa)',
    REJECT: '🔴 REJECT',
  }

  const ticker = payload.ticker.startsWith('$') ? payload.ticker : `$${payload.ticker}`
  const stageLabel = payload.ageMinutes < 120 ? '🆕 New Pair' : '🔗 Post-Bonding'

  L.push(`🎯 *VILONA SNIPER — ${TIER_EMOJI[tier]}*`)
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━')
  L.push(`*Token:* ${escapeSignalMd(ticker)} \`${payload.contract}\``)
  L.push(`*Stage:* ${stageLabel} | *Usia:* ${payload.ageMinutes}m | *Chain:* ${escapeSignalMd(payload.chain ?? 'solana')}`)
  L.push('')

  // ─── MARKET ───
  L.push('📊 *MARKET*')
  L.push(`• Market Cap: ${usd(mom.marketCap)}`)
  const volMcRatio = mom.volume5m != null && mom.marketCap != null && mom.marketCap > 0 ? mom.volume5m / mom.marketCap : null
  L.push(`• Vol 5m: ${usd(mom.volume5m)} | Ratio: ${volMcRatio != null ? volMcRatio.toFixed(2) + 'x' : 'n/a'}`)
  if (volMcRatio != null && volMcRatio >= 5) L.push('   🔥 *Volume sangat tinggi (5x+)*')
  L.push('')

  // ─── SECURITY ───
  L.push('🔐 *KEAMANAN*')
  const mint = sec.mintable === null ? '❓ UNPROVEN' : sec.mintable ? '🔴 ON' : '🟢 OFF'
  const freeze = sec.freezeAuthority === null ? '❓ UNPROVEN' : sec.freezeAuthority ? '🔴 ON' : '🟢 OFF'
  const honeypot = sec.honeypot === null ? '❓ UNPROVEN' : sec.honeypot ? '🔴 YA' : '🟢 AMAN'
  L.push(`• Mint Authority: ${mint}`)
  L.push(`• Freeze Authority: ${freeze}`)
  L.push(`• Honeypot: ${honeypot}`)
  const lpBurned = pct(sec.lpBurnedPercent)
  const lpLocked = pct(sec.lpLockedPercent)
  L.push(`• LP: Burn ${lpBurned} | Lock ${lpLocked}`)
  if (sec.lpBurnedPercent != null && sec.lpBurnedPercent >= 99.5) L.push('   ✅ LP 100% Burnt — aman dari rug pull')
  else if (sec.lpLockedPercent != null && sec.lpLockedPercent >= 99.5) L.push('   ✅ LP 100% Locked — aman dari rug pull')
  else if ((sec.lpBurnedPercent ?? 0) + (sec.lpLockedPercent ?? 0) < 99.5) L.push('   🔴 LP belum 100% aman — risiko exit liquidity')
  L.push('')

  // ─── DISTRIBUTION ───
  L.push('👥 *DISTRIBUSI HOLDER*')
  const dev = pct(dst.devPercent)
  const sniper = pct(dst.sniperPercent)
  const bundler = pct(dst.bundlerPercent)
  const insider = pct(dst.insiderPercent)
  const top10 = pct(dst.top10Percent)
  const cluster = pct(dst.clusterPercent ?? null)
  L.push(`• Dev: ${dev} ${dst.devPercent != null && dst.devPercent > 0 ? '🔴 DEV PEGANG' : dst.devPercent === 0 ? '✅ DEV OUT' : '❓ UNPROVEN'}`)
  L.push(`• Sniper: ${sniper} ${dst.sniperPercent != null && dst.sniperPercent > 6 ? '🔴 TINGGI' : '✅ OK'}`)
  L.push(`• Bundler: ${bundler} ${dst.bundlerSoldPercent != null && dst.bundlerSoldPercent === 100 ? '✅ 100% SOLD' : ''}`)
  L.push(`• Insider: ${insider}`)
  L.push(`• Top 10: ${top10} ${dst.top10Percent != null && dst.top10Percent > 30 ? '🔴 KONSENTRASI TINGGI' : '✅ OK'}`)
  L.push(`• Cluster: ${cluster} ${dst.clusterPercent != null && dst.clusterPercent > 5 ? '🔴 TERDETEKSI' : dst.clusterPercent != null && dst.clusterPercent < 1 ? '✅ BERSIH' : '❓ UNPROVEN'}`)
  L.push('')

  // ─── SMART MONEY ───
  L.push('🧠 *SMART MONEY*')
  if (smartMoney && smartMoney.buyers.length > 0) {
    L.push(`• ${smartMoney.buyers.length} wallet terklasifikasi, terkuat: ${escapeSignalMd(smartMoney.strongest ?? 'n/a')}`)
    for (const b of smartMoney.buyers.slice(0, 3)) {
      const alias = escapeSignalMd(b.alias ?? b.address.slice(0, 8))
      const pnl = b.pnl30d != null ? (b.pnl30d > 0 ? '+' : '') + (b.pnl30d * 100).toFixed(1) + '%' : 'n/a'
      const wr = b.winRate != null ? (b.winRate * 100).toFixed(1) + '%' : 'n/a'
      L.push(`   · ${alias} — ${escapeSignalMd(b.status ?? 'n/a')} | PnL30d ${pnl} | WR ${wr} | n=${b.sampleCount}`)
    }
  } else {
    L.push('• Belum ada wallet terverifikasi memegang token ini')
    L.push(`   Sumber: ${escapeSignalMd(smartMoney?.source ?? 'tidak tersedia')}`)
  }
  L.push('')

  // ─── THESIS / REASONS ───
  if (tierReasons.length > 0) {
    L.push('💡 *ALASAN*')
    for (const r of tierReasons) L.push(`· ${escapeSignalMd(reasonId(r))}`)
    L.push('')
  }

  // ─── SCENARIOS ───
  const targets = scenarioTargets(marketCapUsd, input.multiples)
  if (targets.length > 0) {
    L.push('🎯 *SKENARIO TARGET*')
    for (const t of targets) L.push(`   ${t.multiple}x → MC ${usd(t.targetMcap)}`)
    L.push('   _Aritmatika market cap, bukan harga exit terjamin._')
    L.push('')
  } else {
    L.push('🎯 *SKENARIO:* Market cap tidak tersedia')
    L.push('')
  }

  // ─── RISKS / INVALIDATION ───
  const rl = risks && risks.length > 0 ? risks : ['Tidak ada invalidation yang diberikan — anggap belum tervalidasi']
  L.push('⚠️ *RISIKO / INVALIDASI*')
  for (const r of rl) L.push(`· ${escapeSignalMd(reasonId(r))}`)
  L.push('')

  // ─── MISSING ───
  if (tierMissing.length > 0) {
    L.push('❓ *YANG MASIH HILANG*')
    for (const m of tierMissing) L.push(`· ${escapeSignalMd(reasonId(m))}`)
    L.push('')
  }

  // Footer
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━')
  L.push('_Output screening — sizing & eksekusi milik 1ai-trade-dex._')

  const text = L.join('\n')
  const body = text.length > 4000 ? text.slice(0, 3990) + '\n…(terpotong)' : text
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
/**
 * Inline trade buttons under a signal. Pure URL keyboard — Telegram renders
 * native tap buttons, no extra API surface. Dexscreener URL doubles as the
 * chart link; Axiom/Jupiter are the buy endpoints (pump = pump.fun mint,
 * else the generic Jupiter swap route).
 */
export function contractButtons(contract: string, chain?: string | null): ContractButtons {
  const c = encodeURIComponent(contract)
  const isPump = contract.endsWith('pump')
  return {
    inline_keyboard: [
      [
        { text: '🟢 BUY Axiom', url: `https://axiom.trade/t/${c}` },
        { text: '⚡ BUY Jupiter', url: isPump ? `https://jup.ag/swap/SOL-${c}` : `https://jup.ag/swap/${c}-USDC` },
      ],
      [
        { text: '📊 Dexscreener', url: `https://dexscreener.com/${chain ?? 'solana'}/${c}` },
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
