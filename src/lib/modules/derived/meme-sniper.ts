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
import {
  GOLDEN_NEW_PAIRS,
  GOLDEN_POST_MIGRATED,
  SNIPER_LAUNCH,
  BONDING_POST,
  EXPOSURE_EARLY,
  evaluateProfile,
  type CriteriaProfile,
  type CriteriaProfileId,
  type SniperMetrics as CriteriaMetrics,
} from './sniper-criteria';
// Indonesian rejection phrasing shared with the review digest (value
// import; signal-tier only type-imports this module, so no runtime cycle).
import { rejectionId } from './signal-tier';
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
  /**
   * Launch facts that decide which engine judges the token. `postBonding`
   * is the authoritative migration signal — when the source provider proves
   * it, age is not consulted. null/absent = unproven, fall back to age.
   */
  launch?: {
    postBonding: boolean | null
  }
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
    /** Market cap in USD. Null when the source never proved it. */
    marketCap: number | null
    /** 5-minute volume in USD. Null when the source never proved it. */
    volume5m: number | null
    /** Average unrealized PnL across the top-5 holders, in percent. */
    top5AvgPnlPercent?: number | null
    narrative?: string
  }
}

// Screening verdicts only. There is deliberately no EXECUTE member:
// this repo screens, 1ai-trade-dex executes. A clean setup reads SIGNAL.
export type SniperStatus = 'SIGNAL' | 'WATCHLIST' | 'REJECT'
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

export interface SniperDecision {
  status: SniperStatus
  rationale: string
  /** Every hard-rule breach found (empty when status is EXECUTE/WATCHLIST). */
  rejections: string[]
  /** Non-fatal observations (dump risk, marginal cluster). */
  warnings: string[]
  metrics: SniperMetrics
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
} as const;

const L = SNIPER_LIMITS

function fmtPct(v: unknown): string {
  return isPct(v) ? `${Math.round(v * 10) / 10}` : 'n/a'
}

function fmtUsd(n: unknown): string {
  return isPct(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '$n/a'
}


/**
 * Escape Telegram HTML control characters in dynamic text.
 * The sniper transport sends parse_mode=HTML: only `&`, `<`, `>` are
 * reserved, so a ticker like `A_B` or a mint ending in `pump` can never
 * open a stray entity the way it does under legacy Markdown.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Which engine judges this token. Derived from launch facts, not age alone:
 * a young token that already migrated is post-bonding, and an old token on
 * a bonding curve is still a new pair. Explicit `payload.stage` always wins
 * (the source provider knows more than a timestamp).
 *
 * Order matters — `postBonding` is checked first because a migrated token is
 * past the curve regardless of how few minutes it has existed.
 */
function deriveStage(payload: SniperPayload): SniperStage {
  if (payload.stage) return payload.stage
  if (payload.launch?.postBonding === true) return 'post-bonding'
  if (payload.launch?.postBonding === false) return 'new-pair'
  return payload.ageMinutes < 120 ? 'new-pair' : 'post-bonding'
}

/** The profile that judges this stage by default — the operator's own criteria. */
export function profileForStage(stage: SniperStage): CriteriaProfileId {
  return stage === 'new-pair' ? 'golden-new-pairs' : 'golden-post-migrated'
}

function ageLabel(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} Menit`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h} Jam ${m} Menit` : `${h} Jam`
}

function assessPnl(avg: number | null | undefined): PnlAssessment {
  if (avg === null || avg === undefined) return 'neutral'
  if (avg > L.dumpRiskPnlPercent) return 'dump-risk'
  if (avg < L.accumulationPnlPercent) return 'accumulation'
  return 'neutral'
}

// ── Input shape guard ───────────────────────────────────────────
// The evaluator must treat a malformed value the same as a missing one.
// Upstream JSON (and ad-hoc callers) can hand us a string ('none'), NaN, or
// an error object where a number was expected — JS comparisons then behave
// unpredictably ('none' > 5 is false ⇒ a breach silently passes). A gate is
// only asked to judge a finite number; everything else is UNKNOWN.

/** Finite-number check: null, undefined, NaN, strings and objects all fail. */
function isPct(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function pctOrNull(v: unknown): number | null {
  return isPct(v) ? v : null
}

// ── Hard gates ────────────────────────────────────────────────

function securityBreaches(p: SniperPayload): string[] {
  const out: string[] = []
  const raw = p.security
  // Normalize once: any malformed fact becomes its unproven twin, so the
  // gates below only ever see boolean | null and finite number | null.
  const s = {
    mintable: raw.mintable === false ? false : raw.mintable === true ? true : null,
    freezeAuthority:
      raw.freezeAuthority === false ? false : raw.freezeAuthority === true ? true : null,
    honeypot: raw.honeypot === true ? true : raw.honeypot === false ? false : null,
    lpBurnedPercent: pctOrNull(raw.lpBurnedPercent),
    lpLockedPercent: pctOrNull(raw.lpLockedPercent),
  }

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
  // UNKNOWN is not safe: a honeypot whose status was never proven must not
  // pass a gate the operator treats as a hard sell-side guarantee.
  if (s.honeypot === true) out.push('Honeypot: sells are blocked')
  else if (s.honeypot !== false) {
    out.push('Honeypot status unproven (sell-side safety unknown)')
  }

  // LP legs are distinct facts — lock, burn, and "unavailable" are NOT the
  // same. A null leg means that leg was never proven; it must never be read
  // as 0 nor silently skipped. The rule: burn+lock must cover ~100%, and if
  // the burn leg is unproven while the lock leg is proven 100%, that is
  // exit-safe (a locked LP cannot be pulled). Any other unproven leg is a
  // breach, because the operator's method (materi 07) requires MINT/FREEZE
  // off + LP fully burned or locked before entry.
  const burnedKnown = s.lpBurnedPercent != null
  const lockedKnown = s.lpLockedPercent != null
  const burned = s.lpBurnedPercent ?? 0
  const locked = s.lpLockedPercent ?? 0
  if (!burnedKnown && !lockedKnown) {
    out.push('LP burn/lock unproven (must be 100% burnt or locked)')
  } else if (!burnedKnown && locked >= 99.5) {
    // Locked 100% proves exit safety without the burn leg.
  } else if (!burnedKnown) {
    out.push(
      `LP lock only ${fmtPct(locked)}% and burn unproven — exit liquidity exposed`,
    )
  } else if (!lockedKnown) {
    out.push(
      `LP burn only ${fmtPct(burned)}% and lock unproven — exit liquidity exposed`,
    )
  } else if (burned + locked < 99.5) {
    out.push(`LP only ${fmtPct(burned + locked)}% burnt+locked — exit liquidity exposed`)
  }
  return out
}

// ── Distribution gates ────────────────────────────────────────

function distributionBreaches(p: SniperPayload): string[] {
  const out: string[] = []
  // Malformed facts become UNKNOWN (null); comparisons below stay numeric.
  const rawD = p.distribution
  const d = {
    devPercent: pctOrNull(rawD.devPercent),
    sniperPercent: pctOrNull(rawD.sniperPercent),
    bundlerPercent: pctOrNull(rawD.bundlerPercent),
    bundlerSoldPercent: pctOrNull(rawD.bundlerSoldPercent),
    insiderPercent: pctOrNull(rawD.insiderPercent),
    top10Percent: pctOrNull(rawD.top10Percent),
    clusterPercent: pctOrNull(rawD.clusterPercent),
    topWallets: Array.isArray(rawD.topWallets) ? rawD.topWallets : undefined,
  }

  if (d.devPercent === null) out.push('Dev holding unproven (must be 0%)')
  else if (d.devPercent > L.devPercent) {
    out.push(
      d.devPercent < L.devHardCeilingPercent
        ? `Dev holds ${fmtPct(d.devPercent)}% (must be 0%; hard ceiling ${L.devHardCeilingPercent}%)`
        : `Dev holds ${fmtPct(d.devPercent)}% — beyond hard ceiling`,
    )
  }

  if (d.sniperPercent === null) out.push('Sniper share unproven')
  else if (d.sniperPercent >= L.sniperPercent) {
    out.push(`Snipers hold ${fmtPct(d.sniperPercent)}% (ceiling ${L.sniperPercent}%)`)
  }

  if (d.bundlerPercent === null) out.push('Bundler share unproven')
  else if (d.bundlerPercent >= L.bundlerToleratedPercent) {
    out.push(`Bundlers hold ${fmtPct(d.bundlerPercent)}% — above tolerated max ${L.bundlerToleratedPercent}%`)
  } else if (d.bundlerPercent >= L.bundlerPercent && (d.bundlerSoldPercent ?? 0) < 100) {
    out.push(
      `Bundlers hold ${fmtPct(d.bundlerPercent)}% and have not fully exited (sold ${fmtPct(d.bundlerSoldPercent ?? 0)}%) — ceiling ${L.bundlerPercent}%`,
    )
  }

  if (d.insiderPercent === null) out.push('Insider share unproven')
  else if (d.insiderPercent >= L.insiderPercent) {
    out.push(`Insiders hold ${fmtPct(d.insiderPercent)}% (ceiling ${L.insiderPercent}%)`)
  }

  if (d.top10Percent === null) out.push('Top-10 concentration unproven')
  else if (d.top10Percent >= L.top10Percent) {
    out.push(`Top 10 hold ${fmtPct(d.top10Percent)}% (ceiling ${L.top10Percent}%)`)
  }

  // Cluster is a real fact when a Bubblemap-style source reports it, and
  // UNKNOWN when it does not. `?? 0` would launder an unreported cluster
  // into a proven-zero (best possible) value — UNKNOWN is not a zero.
  if (d.clusterPercent === null) {
    out.push('Linked cluster unproven — cannot rule out coordinated wallets')
  } else if (d.clusterPercent > L.clusterPercent) {
    out.push(`Linked cluster holds ${fmtPct(d.clusterPercent)}% (ceiling ${L.clusterPercent}%)`)
  }

  // Top 1-3 wallets must be broad holders — never fresh/sniper/dev
  // distribution. The kind is only known when a source labels holders; a
  // bare address list proves nothing about taint, so a missing/short list is
  // UNKNOWN, not a pass. No source-supported number is ever invented here.
  const tainted: WalletKind[] = ['fresh', 'sniper', 'dev', 'bundler', 'insider']
  const knownKinds = new Set<string>(['fresh', 'sniper', 'dev', 'bundler', 'insider', 'holder', 'unknown'])
  const clean3 = (d.topWallets ?? [])
    .filter(
      (w): w is NonNullable<typeof w> =>
        !!w && typeof w.address === 'string' && w.address.length > 0,
    )
    .map((w) => ({
      address: w.address,
      percent: pctOrNull((w as { percent?: unknown }).percent),
      kind: knownKinds.has((w as { kind?: unknown }).kind as string)
        ? ((w as { kind?: unknown }).kind as WalletKind)
        : 'unknown',
    }))
    .filter((w) => w.percent !== null)
    .map((w) => ({ address: w.address, percent: w.percent as number, kind: w.kind }))
  const top3 = clean3.slice(0, 3)
  if (top3.length < 3) {
    out.push(
      `Top 1-3 holder identities unproven (${top3.length} of 3 known) — concentration unverifiable`,
    )
  } else if (top3.some((w) => w.kind === 'unknown')) {
    // Addresses known but the source gave no classification: treat as
    // UNKNOWN — a wallet that could be a sniper/dev must not clear the gate.
    out.push('Top 1-3 holder classification unproven — cannot rule out taint')
  } else {
    const bad = top3.find((w) => tainted.includes(w.kind))
    if (bad) {
      out.push(
        `Top wallet ${bad.address.slice(0, 6)}… is a ${bad.kind} wallet (${fmtPct(bad.percent)}%) — not a clean holder`,
      )
    }
  }
  return out
}

function momentumBreaches(p: SniperPayload, stage: SniperStage): { breaches: string[]; ratio: number } {
  const required = stage === 'new-pair' ? L.newPairVolMcRatio : L.postBondingVolMcRatio
  const mc = p.momentum.marketCap
  const vol = p.momentum.volume5m
  if (!isPct(mc) || mc <= 0) return { breaches: ['Market cap is zero/unknown — ratio uncomputable'], ratio: 0 }
  if (!isPct(vol) || vol < 0) {
    return { breaches: ['Volume is unknown — momentum uncomputable'], ratio: 0 }
  }
  const ratio = vol / mc
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
): string {
  const s = p.security
  const mintStatus = s.mintable === false ? '🟢 MATI' : s.mintable === true ? '🔴 HIDUP' : '❓ UNPROVEN'
  const freezeStatus = s.freezeAuthority === false ? '🟢 MATI' : s.freezeAuthority === true ? '🔴 HIDUP' : '❓ UNPROVEN'
  const lpTotal = (s.lpBurnedPercent ?? 0) + (s.lpLockedPercent ?? 0)
  // LP 100% burnt (raydium-style burn) vs 100% locked (streamflow-style
  // locker) — the suffix names which was proven so the operator can verify.
  const burned = s.lpBurnedPercent ?? 0
  const locked = s.lpLockedPercent ?? 0
  const lpStatus =
    burned >= 99.5
      ? '100% BURNT ✅'
      : locked >= 99.5
        ? '100% LOCKED ✅'
        : `${fmtPct(lpTotal)}% 🔴`

  // 2-decimal percents like the reference template (0.00%, 1.8% → 1.80%).
  const pct2 = (v: number | null | undefined): string =>
    v === null || v === undefined ? 'n/a' : v.toFixed(2)

  // Dev annotation: "(Dev Out)" when proven 0, "(Dev In)" when holding.
  const devNote = m.devPercent === 0 ? ' (Dev Keluar ✅)' : m.devPercent != null && m.devPercent > 0 ? ' (Dev PEGANG 🔴)' : ' (UNPROVEN ❓)'
  // PASS = within the hard ceiling (template shows a single trailing emoji
  // per metric; notes carry no emoji of their own).
  const passEmoji = (v: number | null | undefined, ceiling: number): string =>
    v === null || v === undefined ? '❓' : v < ceiling ? '✅' : '🔴'
  // Bundlers: "(100% Sold)" only when the full exit is proven.
  const soldPct = p.distribution.bundlerSoldPercent
  const bundlerNote = soldPct === 100 ? ' (100% SOLD ✅)' : ''
  // Cluster: "(Clean bubblemap)" below 1%.
  const clusterNote =
    m.clusterPercent != null && m.clusterPercent < 1 ? ' (Bersih ✅)' : ''
  // Volume fire: ratio >= 5x.
  const volFire = m.volMcRatio >= 5 ? ' 🔥' : ''

  // Stage suffix: Pump.fun graduated pairs read "(Pump.fun)".
  const stageExtra =
    p.chain === 'solana' && m.stage === 'post-bonding' ? ' (Pump.fun)' : ''
  const pnlText =
    m.avgPnlPercent === null
      ? 'n/a'
      : `${m.avgPnlPercent > 0 ? '+' : ''}${Math.round(m.avgPnlPercent)}`
  // PnL phase labels (ID, matching the reference template).
  const pnlPhase =
    m.pnlAssessment === 'dump-risk'
      ? '(Fase Distribusi ⚠️)'
      : m.pnlAssessment === 'accumulation'
        ? '(Fase Akumulasi Sehat ✅)'
        : '(Netral)'
  const narrative = p.momentum.narrative?.trim() || 'Belum ada data katalis'

  const ticker = p.ticker.startsWith('$') ? p.ticker : `$${p.ticker}`
  const STATUS_EMOJI: Record<SniperStatus, string> = {
    SIGNAL: '🟢 SIGNAL',
    WATCHLIST: '🟡 WATCHLIST',
    REJECT: '🔴 REJECT',
  }
  const statusId: Record<SniperStatus, string> = {
    SIGNAL: 'sinyal layak eksekusi',
    WATCHLIST: 'pantau dulu — belum sinyal utama',
    REJECT: 'ditolak — ada pelanggaran aturan',
  }

  return [
    '🎯 <b>VILONA MEME SNIPER — ALPHA ALERT</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `<b>Token:</b> ${escapeHtml(ticker)} | <code>${escapeHtml(p.contract)}</code>`,
    `<b>Stage:</b> ${escapeHtml(m.stageLabel)}${stageExtra} | <b>Usia:</b> ${escapeHtml(m.ageLabel)}`,
    '',
    '📊 <b>AUDIT &amp; INTEGRITAS ON-CHAIN</b>',
    `• <b>Dev Holding:</b> ${pct2(m.devPercent)}% ${passEmoji(m.devPercent, L.devHardCeilingPercent)}${devNote}`,
    `• <b>Sniper:</b> ${pct2(m.sniperPercent)}% ${passEmoji(m.sniperPercent, L.sniperPercent)} | <b>Bundler:</b> ${pct2(m.bundlerPercent)}%${bundlerNote} ${passEmoji(m.bundlerPercent, L.bundlerPercent)}`,
    `• <b>Insider:</b> ${pct2(m.insiderPercent)}% ${passEmoji(m.insiderPercent, L.insiderPercent)} | <b>Top 10 Supply:</b> ${pct2(m.top10Percent)}% ${passEmoji(m.top10Percent, L.top10Percent)}`,
    `• <b>Cluster:</b> ${pct2(m.clusterPercent)}%${clusterNote} ${passEmoji(m.clusterPercent, L.clusterPercent)}`,
    `• <b>LP &amp; Keamanan:</b> Mint ${mintStatus} | Freeze ${freezeStatus} | LP ${lpStatus}`,
    '',
    '📈 <b>DINAMIKA MARKET</b>',
    `• <b>Market Cap:</b> ${fmtUsd(p.momentum.marketCap)}`,
    `• <b>Volume 5m:</b> ${fmtUsd(p.momentum.volume5m)} (<b>Ratio:</b> ${m.volMcRatio.toFixed(2)}x)${volFire}`,
    `• <b>Top Holder Avg PnL:</b> ${pnlText}% ${pnlPhase}`,
    `• <b>Narasi / Katalis:</b> ${escapeHtml(narrative)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `💡 <b>KEPUTUSAN:</b> ${STATUS_EMOJI[status]} — ${statusId[status]}`,
    `<b>Alasan:</b> ${escapeHtml(rejectionId(rationale))}`,
    '',
    '<i>Output screening — sizing &amp; eksekusi milik 1ai-trade-dex.</i>',
  ].join('\n')
}

export interface EvaluateOptions {
  /** Extra provenance warnings (audit identity) surfaced to the operator. */
  extraWarnings?: string[]
  /**
   * Smart-money confirmation. Confirming evidence only: its absence caps
   * the verdict at WATCHLIST, it never rejects on its own (security gates
   * do that). Absent option == no wallet evidence == treated as unconfirmed.
   */
  smartMoney?: { verdict: 'pass' | 'warn'; reason: string; strongest: string | null }
  /**
   * Ebook criteria override. When set, every named ebook profile
   * (sniper-criteria.ts) ALSO judges the token: a hard reject from any
   * profile adds to rejections, unknowns/warns surface as warnings.
   * Default unset — the inline SNIPER_LIMITS gates keep working exactly
   * as before. Thresholds are never edited here, only selected.
   */
  criteriaProfiles?: CriteriaProfileId[]
}

/**
 * All five ebook profiles, selectable by phase. BONDING_POST and
 * EXPOSURE_EARLY shipped with the criteria module but were unreachable
 * from the live path — now wired to the same gate as the other three.
 */
function profileFor(id: CriteriaProfileId): CriteriaProfile | null {
  switch (id) {
    case 'golden-new-pairs':
      return GOLDEN_NEW_PAIRS
    case 'golden-post-migrated':
      return GOLDEN_POST_MIGRATED
    case 'sniper-launch':
      return SNIPER_LAUNCH
    case 'bonding-post':
      return BONDING_POST
    case 'exposure-early':
      return EXPOSURE_EARLY
    default:
      return null
  }
}

export function evaluateSniper(rawPayload: SniperPayload, opts: EvaluateOptions = {}): SniperDecision {
  // Normalize once at the boundary: every downstream consumer (breach fns,
  // metrics, the Telegram formatter) reads only this object, so a malformed
  // string/NaN/error-object can never reach a comparison or a `.toFixed`.
  // A malformed fact becomes its unproven twin — the safest reading.
  const sec = rawPayload.security
  const dst = rawPayload.distribution
  const mom = rawPayload.momentum
  const payload: SniperPayload = {
    ...rawPayload,
    security: {
      mintable: sec.mintable === false ? false : sec.mintable === true ? true : null,
      freezeAuthority:
        sec.freezeAuthority === false ? false : sec.freezeAuthority === true ? true : null,
      honeypot: sec.honeypot === true ? true : sec.honeypot === false ? false : null,
      lpBurnedPercent: pctOrNull(sec.lpBurnedPercent),
      lpLockedPercent: pctOrNull(sec.lpLockedPercent),
    },
    distribution: {
      devPercent: pctOrNull(dst.devPercent),
      sniperPercent: pctOrNull(dst.sniperPercent),
      bundlerPercent: pctOrNull(dst.bundlerPercent),
      bundlerSoldPercent: pctOrNull(dst.bundlerSoldPercent),
      insiderPercent: pctOrNull(dst.insiderPercent),
      top10Percent: pctOrNull(dst.top10Percent),
      clusterPercent: pctOrNull(dst.clusterPercent),
      topWallets: Array.isArray(dst.topWallets) ? dst.topWallets : undefined,
    },
    momentum: {
      marketCap: pctOrNull(mom.marketCap),
      volume5m: pctOrNull(mom.volume5m),
      top5AvgPnlPercent: pctOrNull(mom.top5AvgPnlPercent),
      narrative: typeof mom.narrative === 'string' ? mom.narrative : undefined,
    },
  }

  const stage = deriveStage(payload)
  const pnlAssessment = assessPnl(payload.momentum.top5AvgPnlPercent)
  // Stage decides its golden profile; a caller can add more with
  // `criteriaProfiles`. The stage default always runs, so a token can never
  // escape the operator's documented criteria by omission.
  const criteriaProfilesToRun: CriteriaProfileId[] = [
    ...new Set([profileForStage(stage), ...(opts.criteriaProfiles ?? [])]),
  ]

  const momentum = momentumBreaches(payload, stage)
  const rejections = [
    ...securityBreaches(payload),
    ...distributionBreaches(payload),
    ...momentum.breaches,
  ]

  const warnings: string[] = []
  if (opts.extraWarnings?.length) warnings.push(...opts.extraWarnings)

  // No execution inputs are read here on purpose: SNIPER_EXECUTE_ENABLED,
  // positionSizeUsd and circuitLocked are trade-dex concerns and must not
  // reappear. Screening answers "is it clean?" — nothing more.

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

  let status: SniperStatus
  let rationale: string

  // Smart money is CONFIRMING evidence: it enriches the rationale and the
  // warning list, but it never gates EXECUTE here — the delivery tier
  // (signal-tier.ts) is what withholds a top-tier signal. Keeping the
  // evaluator's verdict independent means an empty wallet DB cannot
  // silently disable screening.
  const smartMoneyConfirmed = opts.smartMoney?.verdict === 'pass'
  if (opts.smartMoney?.verdict === 'warn') {
    warnings.push(`No smart-money confirmation: ${opts.smartMoney.reason}`)
  }

  // Ebook criteria cross-check (opt-in via opts.criteriaProfile): the
  // Ebook criteria cross-check (opt-in via opts.criteriaProfiles): every
  // named profile judges the same facts once, with the operator's
  // documented thresholds. Rejects append (more evidence), unknowns/warns
  // surface as warnings — a profile never un-rejects an inline breach.
  if (criteriaProfilesToRun.length > 0) {
    // Map every field the profile can read from what the audit actually
    // proved. Fields with no source (freshWalletPct, earlyBuyerPct,
    // devSnipedPct, rugProbabilityPct, proTraderCount, survivedPostBondingMin,
    // bubblemapChained) are left undefined on purpose: the profile reports
    // them as unknown, which is honest — never a silent pass.
    const topWallets = Array.isArray(payload.distribution.topWallets)
      ? payload.distribution.topWallets
      : []
    const singleWhalePct =
      topWallets.length > 0 ? Math.max(...topWallets.map((w) => w.percent)) : null
    const cm: CriteriaMetrics = {
      devHoldingPct: payload.distribution.devPercent,
      sniperPct: payload.distribution.sniperPercent,
      bundlerPct: payload.distribution.bundlerPercent,
      insiderPct: payload.distribution.insiderPercent,
      top10HoldersPct: payload.distribution.top10Percent,
      clusterPct: payload.distribution.clusterPercent,
      singleWhalePct,
      tokenAgeMin: payload.ageMinutes,
      marketCapUsd: payload.momentum.marketCap,
      volumeToMc: momentum.ratio,
      smartWalletPnlPct: payload.momentum.top5AvgPnlPercent,
      lpBurntPct: payload.security.lpBurnedPercent,
      // An unproven authority is NOT "disabled": null stays unknown.
      mintEnabled: payload.security.mintable === null ? null : payload.security.mintable,
      freezeEnabled: payload.security.freezeAuthority === null ? null : payload.security.freezeAuthority,
    }
    for (const profileId of criteriaProfilesToRun) {
      const profile = profileFor(profileId)
      if (!profile) continue
      const res = evaluateProfile(profile, cm)
      for (const r of res.rejects) {
        const line = `[${profile.id}] ${r}`
        if (!rejections.includes(line)) rejections.push(line)
      }
      for (const w of res.warns) {
        const line = `[${profile.id}] ${w}`
        if (!warnings.includes(line)) warnings.push(line)
      }
      for (const u of res.unknowns) {
        const line = `[${profile.id}] ${u}: no data`
        if (!warnings.includes(line)) warnings.push(line)
      }
    }
  }
  if (rejections.length > 0) {
    status = 'REJECT'
    rationale =
      rejections.length === 1 ? rejections[0] : `${rejections.length} hard-rule breaches — ${rejections[0]}`
  } else if (pnlAssessment === 'dump-risk') {
    status = 'WATCHLIST'
    rationale = `Setup is clean and volume is live (${metrics.volMcRatio.toFixed(2)}x), but top holders sit on +${fmtPct(payload.momentum.top5AvgPnlPercent)}% — wait for the flush before entry`
  } else if (smartMoneyConfirmed) {
    status = 'SIGNAL'
    rationale =
      pnlAssessment === 'accumulation'
        ? `Clean distribution with top holders still accumulating (+${fmtPct(payload.momentum.top5AvgPnlPercent)}% avg PnL), ${metrics.volMcRatio.toFixed(2)}x volume, plus confirmed smart money (${opts.smartMoney?.strongest}) — candidate for the downstream executor`
        : `All hard filters passed with live ${metrics.volMcRatio.toFixed(2)}x volume, no concentrated exits, plus confirmed smart money (${opts.smartMoney?.strongest}) — candidate for the downstream executor`
  } else {
    status = 'WATCHLIST'
    rationale =
      pnlAssessment === 'accumulation'
        ? `Screening passed but no verified smart-money buyer — hold for wallet confirmation before it becomes a signal (volume ${metrics.volMcRatio.toFixed(2)}x, accumulating)`
        : `Hard filters clean, volume ${metrics.volMcRatio.toFixed(2)}x, but no verified smart-money buyer — hold for wallet confirmation`
  }

  return {
    status,
    rationale,
    rejections,
    warnings,
    metrics,
    alert: buildAlert(payload, status, rationale, metrics),
  }
}

// ── Telegram delivery ─────────────────────────────────────────

/**
 * Send an alert through the ecosystem's proven channel chain:
 * SCREENING ONLY: this repo never executes. Execution belongs to
 * 1ai-trade-dex; SNIPER_EXECUTE_ENABLED stays unset here, so the
 * evaluator can only ever emit WATCHLIST (no order path exists).
 *
 * Dedicated sniper bot first (SNIPER_TELEGRAM_BOT_TOKEN → its own
 * SNIPER_TELEGRAM_CHAT_ID), then the ecosystem chain:
 * HUB_TELEGRAM_BOT_TOKEN → TELEGRAM_BOT_TOKEN, and
 * HUB_TELEGRAM_OWNER_CHAT_ID → TELEGRAM_ALERT_CHAT_ID → TELEGRAM_ADMIN_CHAT_ID.
 *
 * parse_mode is HTML, NOT legacy Markdown. Proven live 2026-10-12: legacy
 * Markdown 400s with "can't parse entities" whenever an unescaped `_` from
 * a ticker/mint (e.g. `7tZt1LXb`, `bot_`) opens an italic span, and the
 * failure is silent (returns false → review digest logs "telegram
 * rejected"). HTML only needs `&`, `<`, `>` escaped, so dynamic token data
 * (which never contains those) cannot break the message. See `escapeSignalHtml`.
 * Returns false (never throws) when unconfigured or the API rejects.
 */
export async function deliverSniperAlert(
  text: string,
  chatId?: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> },
): Promise<boolean> {
  const token =
    process.env.SNIPER_TELEGRAM_BOT_TOKEN ||
    process.env.HUB_TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ''
  const chat =
    chatId ||
    process.env.SNIPER_TELEGRAM_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ALERT_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  if (!token || !chat) return false
  // Telegram caps sendMessage text at 4096 chars — truncate there, never let
  // a digest die on 400 simply for being one block too long.
  const body = text.length > 4096 ? text.slice(0, 4090) + '…' : text
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: body,
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return true
      const errBody = await res.text().catch(() => '')
      console.error(`[sniper] telegram send failed: HTTP ${res.status} ${errBody.slice(0, 300)}`)
      // 400 = parse error — retry won't help, bail immediately
      if (res.status === 400) return false
      // 429 = rate limited — respect Retry-After if present
      if (res.status === 429) {
        const ra = errBody.match(/"retry_after"\s*:\s*(\d+)/)
        const wait = ra ? Math.min(Number(ra[1]), 30) : 5
        if (attempt === 1) { await new Promise(r => setTimeout(r, wait * 1000)); continue }
      }
      return false
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[sniper] telegram send error (attempt ${attempt}/2): ${msg}`)
      if (attempt === 2) return false
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  return false
}
