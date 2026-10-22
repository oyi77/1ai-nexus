// ─────────────────────────────────────────────────────────────
// Meme sniper — evaluator + Telegram alert renderer.
// Verbatim carve from meme-sniper.ts (800-line gate split).
// Consumers keep importing from '@/lib/modules/derived/meme-sniper'.
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
import {
  SNIPER_LIMITS,
  escapeHtml,
  profileForStage,
  type PnlAssessment,
  type SniperDecision,
  type SniperMetrics,
  type SniperPayload,
  type SniperStage,
  type SniperStatus,
  type WalletKind,
} from './meme-sniper-types';

const L = SNIPER_LIMITS

function fmtPct(v: unknown): string {
  return isPct(v) ? `${Math.round(v * 10) / 10}` : 'n/a'
}

function fmtUsd(n: unknown): string {
  return isPct(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '$n/a'
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

function securityBreaches(p: SniperPayload): { breaches: string[]; unknowns: string[] } {
  const breaches: string[] = []
  const unknowns: string[] = []
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
    breaches.push(
      s.mintable === null
        ? 'Mint authority unproven (must be disabled)'
        : 'Mint authority ENABLED — dev can inflate',
    )
  }
  if (s.freezeAuthority !== false) {
    breaches.push(
      s.freezeAuthority === null
        ? 'Freeze authority unproven (must be disabled)'
        : 'Freeze authority ENABLED — holders can be frozen',
    )
  }
  // UNKNOWN is not safe: a honeypot whose status was never proven must not
  // pass a gate the operator treats as a hard sell-side guarantee.
  if (s.honeypot === true) breaches.push('Honeypot: sells are blocked')
  else if (s.honeypot !== false) {
    breaches.push('Honeypot status unproven (sell-side safety unknown)')
  }

  // LP legs are distinct facts — lock, burn, and "unavailable" are NOT the
  // same. A null leg means that leg was never proven; it must never be read
  // as 0 nor silently skipped.
  //
  // Burn data is source-dependent: RugCheck reports LP LOCK but never LP
  // BURN, so lpBurnedPercent is null for the majority of real tokens — not
  // because burn didn't happen, but because no source measured it. Treating
  // that null as a breach (the old behavior) killed ~53 of ~903 tokens on
  // "LP burn/lock unproven" alone — false rejections on missing DATA, not
  // missing SAFETY.
  //
  // Operator-approved three-state policy:
  //   BREACH   — a source CONFIRMED lpBurnedPercent === 0 AND lock is
  //              insufficient (< 99.5%): exit liquidity is genuinely exposed.
  //   UNKNOWN  — no source proved burn (lpBurnedPercent == null). The token
  //              is NOT killed; it continues through the other gates. But
  //              UNKNOWN is never PASS: it caps the verdict at WATCHLIST
  //              (handled in evaluateSniper) so it can never become a
  //              top-signal delivery on missing data.
  //   PASS     — burn proven sufficient, or lock proven >= 99.5% (a locked
  //              LP cannot be pulled, so exit safety is proven without burn).
  const burnedKnown = s.lpBurnedPercent != null
  const lockedKnown = s.lpLockedPercent != null
  const burned = s.lpBurnedPercent ?? 0
  const locked = s.lpLockedPercent ?? 0
  if (burnedKnown && lockedKnown) {
    if (burned + locked < 99.5) {
      breaches.push(`LP only ${fmtPct(burned + locked)}% burnt+locked — exit liquidity exposed`)
    }
  } else if (burnedKnown) {
    // Burn proven, lock unknown. If burn alone covers ~100%, exit-safe.
    if (burned < 99.5) {
      breaches.push(`LP burn only ${fmtPct(burned)}% — exit liquidity exposed`)
    }
  } else if (lockedKnown) {
    // Lock proven, burn unknown. Lock >= 99.5% proves exit safety (a locked
    // LP cannot be pulled) without needing the burn leg. Partial lock is a
    // BREACH — the un-burnt remainder is pullable.
    if (locked < 99.5) {
      breaches.push(`LP lock only ${fmtPct(locked)}% — exit liquidity exposed`)
    }
  } else {
    // Neither leg proven by any source. This is the 53-rejection case:
    // not "burn didn't happen" but "no source measured it". UNKNOWN, not
    // BREACH — the token continues through other gates but can never
    // become a top signal on missing data.
    unknowns.push('LP burn/lock unproven — no source measured it (not a breach, but never a pass)')
  }
  return { breaches, unknowns }
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
  const volRatioText = m.volMcRatio === null ? 'n/a' : `${m.volMcRatio.toFixed(2)}x`
  const volFire = m.volMcRatio !== null && m.volMcRatio >= 5 ? ' 🔥' : ''

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
    `• <b>Volume 5m:</b> ${fmtUsd(p.momentum.volume5m)} (<b>Ratio:</b> ${volRatioText})${volFire}`,
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
  const secGates = securityBreaches(payload)
  const rejections = [
    ...secGates.breaches,
    ...distributionBreaches(payload),
    ...momentum.breaches,
  ]

  const warnings: string[] = []
  if (opts.extraWarnings?.length) warnings.push(...opts.extraWarnings)
  // Security UNKNOWNs (e.g. LP burn unmeasured by any source) are non-fatal
  // advisories: they do NOT reject, but they cap the verdict at WATCHLIST
  // (handled below) so the token can never become a top-signal delivery on
  // missing data. The operator policy: UNKNOWN ≠ PASS, UNKNOWN ≠ BREACH.
  const securityUnknowns = secGates.unknowns
  for (const u of securityUnknowns) {
    if (!warnings.includes(u)) warnings.push(u)
  }
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
  const volRatioText =
    metrics.volMcRatio === null ? 'n/a' : `${metrics.volMcRatio.toFixed(2)}x`

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
    rationale = `Setup is clean and volume is live (${volRatioText}), but top holders sit on +${fmtPct(payload.momentum.top5AvgPnlPercent)}% — wait for the flush before entry`
  } else if (securityUnknowns.length > 0) {
    // UNKNOWN is a third state, not a pass: a token whose LP burn/lock was
    // never measured cannot become a SIGNAL (which the tier classifier would
    // promote to a top-signal delivery). It is not rejected either — it
    // continues as a WATCHLIST so the operator can still see it and decide.
    status = 'WATCHLIST'
    rationale = `Screening passed but security evidence is incomplete — ${securityUnknowns[0]} (not a rejection, but never a top signal on missing data)`
  } else if (smartMoneyConfirmed) {
    status = 'SIGNAL'
    rationale =
      pnlAssessment === 'accumulation'
        ? `Clean distribution with top holders still accumulating (+${fmtPct(payload.momentum.top5AvgPnlPercent)}% avg PnL), ${volRatioText} volume, plus confirmed smart money (${opts.smartMoney?.strongest}) — candidate for the downstream executor`
        : `All hard filters passed with live ${volRatioText} volume, no concentrated exits, plus confirmed smart money (${opts.smartMoney?.strongest}) — candidate for the downstream executor`
  } else {
    status = 'WATCHLIST'
    rationale =
      pnlAssessment === 'accumulation'
        ? `Screening passed but no verified smart-money buyer — hold for wallet confirmation before it becomes a signal (volume ${volRatioText}, accumulating)`
        : `Hard filters clean, volume ${volRatioText}, but no verified smart-money buyer — hold for wallet confirmation`
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
