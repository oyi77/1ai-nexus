// ─────────────────────────────────────────────────────────────
// Module: RugCheck.xyz — Meme Alpha (security / rug report)
// sourceType: public-api
// upstreamProduct: RugCheck.xyz (rugcheck.xyz)
// endpoint: https://api.rugcheck.xyz/v1/tokens/{address}/report
// discoveredVia: docs
// lastVerified: 2026-08-30
// Auth: NONE. Public API, no key. Chain: Solana (primarily).
// Audit-only module — no discovery endpoint (Birdeye covers discovery).
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import type { MemeRiskAudit } from '../types'

const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1/tokens'

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Raw payload shapes (RugCheck report) ──────────────────────

interface RugCheckRisk {
  name?: string
  value?: unknown
  description?: string
  score?: number
}

interface RugCheckTopHolder {
  address?: string
  pct?: number
  balance?: number
  owner?: string
}

interface RugCheckMarketLp {
  lpLockedPct?: number
  lpLockedUSD?: number
  quoteUSD?: number
  baseUSD?: number
}

interface RugCheckMarket {
  lp?: RugCheckMarketLp | null
}

interface RugCheckInsiderNetwork {
  size?: number
  currentHolding?: number
  tokenAmount?: number
}

interface RugCheckReport {
  mint?: string
  tokenMeta?: { name?: string; symbol?: string; mutable?: boolean; updateAuthority?: string | null }
  score?: number
  risks?: RugCheckRisk[]
  topHolders?: RugCheckTopHolder[]
  mintAuthority?: string | null
  freezeAuthority?: string | null
  totalHolders?: number
  totalMarketLiquidity?: number
  totalStableLiquidity?: number
  rugged?: boolean
  graphInsidersDetected?: boolean
  token?: { supply?: number; decimals?: number }
  markets?: RugCheckMarket[]
  insiderNetworks?: RugCheckInsiderNetwork[]
  creator?: string | null
  creatorBalance?: number
}

// ── Normalizers ───────────────────────────────────────────────

/** Map RugCheck score (0=safe, 100=riskier) to 0..3 risk level. */
function scoreToRiskLevel(score: number): number {
  if (score >= 75) return 3
  if (score >= 50) return 2
  if (score >= 25) return 1
  return 0
}

function riskCountsFrom(risks: RugCheckRisk[] = []): { high: number; middle: number; low: number } {
  let high = 0
  let middle = 0
  let low = 0
  for (const r of risks) {
    const s = toNum(r.score)
    if (s >= 20) high++
    else if (s >= 10) middle++
    else if (s > 0) low++
  }
  return { high, middle, low }
}

// ── Risk audit ────────────────────────────────────────────────

export async function auditRugcheckToken(chain: string, contract: string): Promise<MemeRiskAudit | null> {
  try {
    const res = await fetch(`${RUGCHECK_BASE}/${encodeURIComponent(contract)}/report`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const report = (await res.json()) as RugCheckReport

    const riskLevel = scoreToRiskLevel(toNum(report.score))
    const riskLabel = (['safe', 'low', 'middle', 'high'][riskLevel] ||
      'unknown') as MemeRiskAudit['riskLabel']

    // Top-10 holder concentration: sum topHolders[0..9].pct (percent → fraction).
    let top10HolderPercent = 0
    for (const h of report.topHolders?.slice(0, 10) ?? []) {
      top10HolderPercent += toNum(h.pct) / 100
    }
    top10HolderPercent = Math.min(1, top10HolderPercent)

    const meta = report.tokenMeta ?? {}

    // LP lock: USD-weighted fraction across all markets (a token with many
    // pools must not pass on a single 100%-locked dust pool). 0..1 fraction.
    // -1 when the report carries no LP data at all.
    let lpLockedPercent = -1
    let totUsd = 0
    let lockedUsd = 0
    for (const m of report.markets ?? []) {
      const lp = m.lp
      if (!lp) continue
      totUsd += toNum(lp.quoteUSD) + toNum(lp.baseUSD)
      lockedUsd += toNum(lp.lpLockedUSD)
    }
    if (totUsd > 0) lpLockedPercent = Math.min(1, lockedUsd / totUsd)

    // Holder-distribution breakdown for the sniper (fractions 0..1).
    // totalSupply comes from token.account-style `token.supply` (raw units);
    // `creatorBalance` is raw units in the same base — ratio is unit-free.
    let devPercent: number | undefined
    const supply = toNum(report.token?.supply)
    if (supply > 0 && report.creatorBalance !== undefined && report.creatorBalance !== null) {
      devPercent = toNum(report.creatorBalance) / supply
    }
    // Insider networks: linked clusters holding the token. The largest
    // cluster's currentHolding / supply is the linked-cluster share.
    let clusterPercent: number | undefined
    let insiderPercent = 0
    if (supply > 0) {
      let maxCluster = 0
      for (const net of report.insiderNetworks ?? []) {
        const holding = toNum(net.currentHolding)
        maxCluster = Math.max(maxCluster, holding / supply)
        insiderPercent += holding / supply
      }
      if ((report.insiderNetworks ?? []).length > 0) clusterPercent = Math.min(1, maxCluster)
      insiderPercent = Math.min(1, insiderPercent)
    }

    // Top-holder addresses + percents feed the sniper's top-1-3 taint gate.
    const topWallets = (report.topHolders ?? []).slice(0, 5).map((h) => ({
      address: h.address ?? '',
      percent: toNum(h.pct) / 100,
    }))

    return {
      id: `${chain || 'solana'}:${contract}`,
      platform: 'rugcheck',
      chain: chain || 'solana',
      contract,
      symbol: meta.symbol ?? '',
      name: meta.name ?? '',
      riskLevel,
      riskLabel,
      buyTax: 0,
      sellTax: 0,
      top10HolderPercent,
      lpLockedPercent,
      distribution:
        devPercent === undefined && insiderPercent === 0 && clusterPercent === undefined
          ? undefined
          : { devPercent, insiderPercent, clusterPercent },
      topWallets,
      canFreeze: !!report.freezeAuthority,
      canMint: !!report.mintAuthority,
      isHoneypot: false, // not reported by this source
      riskCounts: riskCountsFrom(report.risks),
      auditedAt: Date.now(),
    }
  } catch {
    return null
  }
}
