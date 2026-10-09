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
    /** Market cap in USD. Null when the source never proved it. */
    marketCap: number | null
    /** 5-minute volume in USD. Null when the source never proved it. */
    volume5m: number | null
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

function fmtPct(v: unknown): string {
  return isPct(v) ? `${Math.round(v * 10) / 10}` : 'n/a'
}

function fmtUsd(n: unknown): string {
  return isPct(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '$n/a'
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
  plan: SniperPlan,
): string {
  const s = p.security
  const mintStatus = s.mintable === false ? 'OFF' : 'ON 🔴'
  const freezeStatus = s.freezeAuthority === false ? 'OFF' : 'ON 🔴'
  const lpTotal = (s.lpBurnedPercent ?? 0) + (s.lpLockedPercent ?? 0)
  // LP 100% burnt (raydium-style burn) vs 100% locked (streamflow-style
  // locker) — the suffix names which was proven so the operator can verify.
  const burned = s.lpBurnedPercent ?? 0
  const locked = s.lpLockedPercent ?? 0
  const lpStatus =
    burned >= 99.5
      ? '100% Burnt ✅'
      : locked >= 99.5
        ? '100% Locked ✅'
        : `${fmtPct(lpTotal)}% 🔴`

  // 2-decimal percents like the reference template (0.00%, 1.8% → 1.80%).
  const pct2 = (v: number | null | undefined): string =>
    v === null || v === undefined ? 'n/a' : v.toFixed(2)

  // Dev annotation: "(Dev Out)" when proven 0, "(Dev In)" when holding.
  const devNote = m.devPercent === 0 ? ' (Dev Out)' : m.devPercent != null && m.devPercent > 0 ? ' (Dev In)' : ''
  // PASS = within the hard ceiling (template shows a single trailing emoji
  // per metric; notes carry no emoji of their own).
  const passEmoji = (v: number | null | undefined, ceiling: number): string =>
    v === null || v === undefined ? '🔴' : v < ceiling ? '✅' : '🔴'
  // Bundlers: "(100% Sold)" only when the full exit is proven.
  const soldPct = p.distribution.bundlerSoldPercent
  const bundlerNote = soldPct === 100 ? ' (100% Sold)' : ''
  // Cluster: "(Clean bubblemap)" below 1%.
  const clusterNote =
    m.clusterPercent != null && m.clusterPercent < 1 ? ' (Clean bubblemap)' : ''
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
      ? '(Fase Distribusi)'
      : m.pnlAssessment === 'accumulation'
        ? '(Fase Akumulasi Sehat)'
        : '(Netral)'
  const narrative = p.momentum.narrative?.trim() || 'No catalyst data provided'

  const ticker = p.ticker.startsWith('$') ? p.ticker : `$${p.ticker}`
  const STATUS_EMOJI: Record<SniperStatus, string> = {
    EXECUTE: '🟢 EXECUTE SNIPE',
    WATCHLIST: '🟡 WATCHLIST',
    REJECT: '🔴 REJECT',
  }

  // Entry math on the fixed position: TP1 doubles the principal ($5→$10 at
  // the default) and the stop is -70% of the entry.
  const tp1Usd = plan.sizeUsd * (1 + plan.tp1Pct / 100)

  return [
    '🎯 *VILONA MEME SNIPER — ALPHA ALERT*',
    '━━━━━━━━━━━━━━━━━━━━',
    `*Token:* ${escapeMd(ticker)} | \`${escapeMd(p.contract)}\``,
    `*Stage:* ${m.stageLabel}${stageExtra} | *Age:* ${m.ageLabel}`,
    '',
    '📊 *AUDIT & ON-CHAIN INTEGRITY*',
    `• *Dev Holding:* ${pct2(m.devPercent)}% ${passEmoji(m.devPercent, L.devHardCeilingPercent)}${devNote}`,
    `• *Snipers:* ${pct2(m.sniperPercent)}% ${passEmoji(m.sniperPercent, L.sniperPercent)} | *Bundlers:* ${pct2(m.bundlerPercent)}%${bundlerNote} ${passEmoji(m.bundlerPercent, L.bundlerPercent)}`,
    `• *Insider:* ${pct2(m.insiderPercent)}% ${passEmoji(m.insiderPercent, L.insiderPercent)} | *Top 10 Supply:* ${pct2(m.top10Percent)}% ${passEmoji(m.top10Percent, L.top10Percent)}`,
    `• *Cluster Status:* ${pct2(m.clusterPercent)}%${clusterNote} ${passEmoji(m.clusterPercent, L.clusterPercent)}`,
    `• *LP & Security:* Mint ${mintStatus} | Freeze ${freezeStatus} | LP ${lpStatus}`,
    '',
    '📈 *MARKET DYNAMICS*',
    `• *Market Cap:* ${fmtUsd(p.momentum.marketCap)}`,
    `• *Volume:* ${fmtUsd(p.momentum.volume5m)} (*Ratio:* ${m.volMcRatio.toFixed(2)}x)${volFire}`,
    `• *Top Holder Avg PnL:* ${pnlText}% ${pnlPhase}`,
    `• *Narrative / Catalyst:* ${escapeMd(narrative)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `💡 *DECISION:* *[${STATUS_EMOJI[status]}]*`,
    `*Rationale:* ${escapeMd(rationale)}`,
    `*Setup:* Entry $${plan.sizeUsd.toFixed(2)} | Stop Loss: -${plan.stopLossPct}% (-$${plan.slAmountUsd.toFixed(2)}) | TP1: +${plan.tp1Pct}% ($${tp1Usd.toFixed(2)})`,
  ].join('\n')
}

// ── Evaluator ─────────────────────────────────────────────────

export interface EvaluateOptions {
  /** When true, no snipe may be issued — the daily stop circuit is armed. */
  circuitLocked?: boolean
  /** Requested position size; clamped to the fixed degen band. */
  positionSizeUsd?: number
  /**
   * Snipe execution gate. Defaults to SNIPER_EXECUTE_ENABLED === 'true', so
   * an unset env means WATCHLIST-only: screening must be operator-verified
   * before the evaluator is allowed to say EXECUTE again.
   */
  executeEnabled?: boolean
  /** Extra provenance warnings (audit identity) surfaced to the operator. */
  extraWarnings?: string[]
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

  const momentum = momentumBreaches(payload, stage)
  const rejections = [
    ...securityBreaches(payload),
    ...distributionBreaches(payload),
    ...momentum.breaches,
  ]

  const warnings: string[] = []
  if (opts.extraWarnings?.length) warnings.push(...opts.extraWarnings)

  const executeEnabled = opts.executeEnabled ?? process.env.SNIPER_EXECUTE_ENABLED === 'true'

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
  } else if (executeEnabled) {
    status = 'EXECUTE'
    rationale =
      pnlAssessment === 'accumulation'
        ? `Clean distribution with top holders still accumulating (+${fmtPct(payload.momentum.top5AvgPnlPercent)}% avg PnL) and ${metrics.volMcRatio.toFixed(2)}x volume — asymmetry favors early entry`
        : `All hard filters passed with live ${metrics.volMcRatio.toFixed(2)}x volume and no concentrated exits — clean asymmetric entry`
  } else {
    status = 'WATCHLIST'
    rationale =
      pnlAssessment === 'accumulation'
        ? `Screening passed but execution is gated (SNIPER_EXECUTE_ENABLED ≠ 'true'): asymmetry favors early entry once the operator verifies the screen — top holders accumulating (+${fmtPct(payload.momentum.top5AvgPnlPercent)}% avg PnL), volume ${metrics.volMcRatio.toFixed(2)}x`
        : `Screening passed but execution is gated (SNIPER_EXECUTE_ENABLED ≠ 'true'): hard filters clean, volume ${metrics.volMcRatio.toFixed(2)}x — operator must verify before entry`
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
 * Dedicated sniper bot first (SNIPER_TELEGRAM_BOT_TOKEN → its own
 * SNIPER_TELEGRAM_CHAT_ID), then the ecosystem chain:
 * HUB_TELEGRAM_BOT_TOKEN → TELEGRAM_BOT_TOKEN, and
 * HUB_TELEGRAM_OWNER_CHAT_ID → TELEGRAM_ALERT_CHAT_ID → TELEGRAM_ADMIN_CHAT_ID.
 * Returns false (never throws) when unconfigured or the API rejects.
 */
export async function deliverSniperAlert(text: string, chatId?: string): Promise<boolean> {
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
