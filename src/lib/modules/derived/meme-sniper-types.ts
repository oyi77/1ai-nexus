// ─────────────────────────────────────────────────────────────
// Meme sniper — shared types + stage/limit helpers.
// Verbatim carve from meme-sniper.ts (800-line gate split).
// Consumers keep importing from '@/lib/modules/derived/meme-sniper'.
// ─────────────────────────────────────────────────────────────
import type { CriteriaProfileId } from './sniper-criteria';

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
  name?: string
  liquidityUsd?: number | null
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
  /** null when the token has no measured momentum yet (metric unknown, not zero). */
  volMcRatio: number | null
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

/**
 * Escape Telegram HTML control characters in dynamic text.
 * The sniper transport sends parse_mode=HTML: only `&`, `<`, `>` are
 * reserved, so a ticker like `A_B` or a mint ending in `pump` can never
 * open a stray entity the way it does under legacy Markdown.
 */
export function escapeHtml(s: string | null | undefined): string {
  if (typeof s !== 'string') return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The profile that judges this stage by default — the operator's own criteria. */
export function profileForStage(stage: SniperStage): CriteriaProfileId {
  return stage === 'new-pair' ? 'golden-new-pairs' : 'golden-post-migrated'
}
