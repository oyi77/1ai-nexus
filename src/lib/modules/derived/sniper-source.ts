// ─────────────────────────────────────────────────────────────
// Meme Sniper source — discovery → audit → SniperPayload.
//
// Takes a live discovery row (any platform) plus the same token's risk
// audits, and builds the evaluator's SniperPayload. Honest mapping rules:
//   - a field is only set when an upstream source reports it; missing
//     means null ("unproven"), which the evaluator treats as a breach —
//     never as safe.
//   - 5m volume comes from dexscreener `volume.m5` when the discovery row
//     carries it (raw passthrough), else null (dead momentum → REJECT).
//   - LP burn/lock: rugcheck USD-weighted locked fraction is a LOCKED
//     fraction, never a burn claim; burnt stays null unless a source proves
//     it (conservative: an unlocked-but-unburnt LP is a breach anyway when
//     locked+burnt < 100%).
//   - top-1-3 taint kinds default to 'holder' only for GMGN-provided top
//     wallets — taint itself must come from a label source (dev address
//     match). Without labels, listing them only feeds the size check; the
//     dev/sniper share gates carry the real weight.
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemeRiskAudit } from '@/lib/modules/meme/types'
import type { SniperPayload } from '@/lib/modules/derived/meme-sniper'

/** Raw passthrough for discovery rows that already carry 5m volume. */
export interface SniperEnrichedToken extends MemeAlphaToken {
  /** 5-minute volume in USD (dexscreener volume.m5 shape). */
  volume5m?: number | null
  /** Free-text catalyst when the source provides one. */
  narrative?: string | null
}

function asPct01(v: number | null | undefined): number | null {
  // Birdeye groups arrive as 0..1 fraction or 0..100 percent; audit mappers
  // already normalize to 0..1, but the rugcheck top10 sum can exceed 1.
  if (v === null || v === undefined) return null
  if (!Number.isFinite(v)) return null
  if (v < 0) return null
  const frac = v > 1 ? v / 100 : v
  return Math.min(1, frac) * 100 // sniper payload is percent 0..100
}

function mergeAudits(audits: MemeRiskAudit[]): {
  mintable: boolean | null
  freezeAuthority: boolean | null
  lpBurnedPercent: number | null
  lpLockedPercent: number | null
  honeypot: boolean | null
  devPercent: number | null
  sniperPercent: number | null
  bundlerPercent: number | null
  bundlerSoldPercent: number | null
  insiderPercent: number | null
  top10Percent: number | null
  clusterPercent: number | null
  topWallets: SniperPayload['distribution']['topWallets']
} {
  let mintable: boolean | null = null
  let freeze: boolean | null = null
  let lpLocked: number | null = null
  let honeypot: boolean | null = null
  let dev: number | null = null
  let sniper: number | null = null
  let bundler: number | null = null
  let insider: number | null = null
  let top10: number | null = null
  let cluster: number | null = null
  let topWallets: SniperPayload['distribution']['topWallets'] = undefined

  // Only these platforms read actual authority data — every other audit
  // emits canMint/canFreeze/isHoneypot=false for "not reported" (birdeye's
  // security_details rows are a static 61-row catalog, proven identical for
  // a renounced mint vs a fresh pump token 2026-10-09). Trusting those
  // falses let one blind source launder a real authority into "proven off".
  const TRUSTED_SECURITY = new Set(['rugcheck', 'gmgn', 'gate'])
  for (const a of audits) {
    // Security is disjunctive: ANY trusted source proving a bad fact wins.
    // Untrusted falses are skipped, never counted as "proven off".
    const trusted = TRUSTED_SECURITY.has(a.platform)
    if (!trusted) continue
    if (a.canMint) mintable = true
    else if (mintable === null) mintable = false
    if (a.canFreeze) freeze = true
    else if (freeze === null) freeze = false
    if (a.isHoneypot) honeypot = true
    else if (honeypot === null) honeypot = false
  }
  for (const a of audits) {

    // LP locked: best reported fraction wins (rugcheck USD-weighted).
    // lpLockedPercent -1 means "unknown from this source".
    if (a.lpLockedPercent >= 0) {
      const frac = a.lpLockedPercent > 1 ? a.lpLockedPercent / 100 : a.lpLockedPercent
      const pct = Math.min(1, frac) * 100
      if (lpLocked === null || pct > lpLocked) lpLocked = pct
    }

    // Top-10: the WORST (highest) concentration wins.
    if (a.top10HolderPercent > 0) {
      const pct = Math.min(1, a.top10HolderPercent) * 100
      if (top10 === null || pct > top10) top10 = pct
    }

    const d = a.distribution
    if (d) {
      const take = (cur: number | null, v: number | undefined): number | null => {
        const pct = asPct01(v)
        if (pct === null) return cur
        // Concentration fields: worst wins. Exit fields: best wins.
        return cur === null ? pct : Math.max(cur, pct)
      }
      dev = take(dev, d.devPercent)
      sniper = take(sniper, d.sniperPercent)
      bundler = take(bundler, d.bundlerPercent)
      insider = take(insider, d.insiderPercent)
      cluster = take(cluster, d.clusterPercent)
    }

    // Top wallets: prefer the longest list (GMGN passes 5 with addresses).
    if (a.topWallets && a.topWallets.length > (topWallets?.length ?? 0)) {
      topWallets = a.topWallets.map((w) => ({
        address: w.address,
        percent: (w.percent > 1 ? w.percent / 100 : w.percent) * 100,
        // RugCheck flags insider/creator-linked wallets — preserve the taint
        // so the top-1-3 gate actually fires instead of trusting every
        // top holder as 'holder'.
        kind: w.insider === true ? ('insider' as const) : ('holder' as const),
      }))
    }
  }

  return {
    mintable,
    freezeAuthority: freeze,
    lpBurnedPercent: null, // no source proves burn yet — unproven, never assumed
    lpLockedPercent: lpLocked,
    honeypot,
    devPercent: dev,
    sniperPercent: sniper,
    bundlerPercent: bundler,
    bundlerSoldPercent: null, // exit proof requires a bundler-position tracker
    insiderPercent: insider,
    top10Percent: top10,
    clusterPercent: cluster,
    topWallets,
  }
}

/**
 * Build an evaluator-ready SniperPayload from a live discovery row and the
 * audits already collected for the same contract. Pure — zero I/O.
 */
export function toSniperPayload(
  token: SniperEnrichedToken,
  audits: MemeRiskAudit[],
): SniperPayload {
  const sec = mergeAudits(audits)
  const ageMinutes =
    token.createdAt != null && token.createdAt > 0
      ? Math.max(0, (Date.now() - token.createdAt) / 60_000)
      : Number.POSITIVE_INFINITY // unknown age → post-bonding gates (stricter)

  return {
    ticker: token.symbol || token.name || token.contract.slice(0, 8),
    contract: token.contract,
    chain: token.chain,
    ageMinutes: Number.isFinite(ageMinutes) ? Math.round(ageMinutes) : 10_000,
    security: {
      mintable: sec.mintable,
      freezeAuthority: sec.freezeAuthority,
      lpBurnedPercent: sec.lpBurnedPercent,
      lpLockedPercent: sec.lpLockedPercent,
      honeypot: sec.honeypot,
    },
    distribution: {
      devPercent: sec.devPercent,
      sniperPercent: sec.sniperPercent,
      bundlerPercent: sec.bundlerPercent,
      bundlerSoldPercent: sec.bundlerSoldPercent,
      insiderPercent: sec.insiderPercent,
      top10Percent: sec.top10Percent,
      clusterPercent: sec.clusterPercent ?? undefined,
      topWallets: sec.topWallets,
    },
    momentum: {
      marketCap: token.marketCap,
      volume5m: token.volume5m ?? 0,
      top5AvgPnlPercent: null, // no holder-PnL source wired yet — neutral, never faked
      narrative: token.narrative ?? undefined,
    },
  }
}
