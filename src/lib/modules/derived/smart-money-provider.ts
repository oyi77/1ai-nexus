// ─────────────────────────────────────────────────────────────
// Smart-money provider — wallet DB → screening evidence.
//
// Answers one question for a screening pass: "which classified wallets
// are holding/buying THIS token, and what does their classification say?"
//
// carries the classifier's status + metrics + provenance so the gate can
// weigh a QUALIFIED_SMART_MONEY buy differently from a WATCHLIST buy.
//
// UNKNOWN discipline: a wallet with status UNKNOWN contributes NO
// evidence (its classification is not a signal); wallets whose
// classifiedAt is stale beyond the TTL are reported as stale and
// excluded from the count.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

/** Statuses that cout as bullish evidence,n strongest first. */
export const BULLISH_STATUSES = [
  'WHALE_AND_SMART_MONEY',
  'QUALIFIED_SMART_MONEY',
  'WHALE',
  'PROVISIONAL',
] as const

export type BullishStatus = (typeof BULLISH_STATUSES)[number]

export interface WalletBuyer {
  walletId: string
  address: string
  alias: string | null
  status: string | null
  pnl30d: number | null
  winRate: number | null
  sampleCount: number
  classifiedAt: Date | null
  /** USD value of the wallet's current holding in this token, if known. */
  holdingUsd: number | null
  /** True when classification is older than the freshness TTL. */
  stale: boolean
}

export interface SmartMoneyEvidence {
  contract: string
  chain: string
  /** Bullish wallets only (known status + fresh). */
  buyers: WalletBuyer[]
  /** Total wallets holding this token that we have classified. */
  walletsHolding: number
  /** Count of bullish statuses, by status. */
  byStatus: Record<string, number>
  /** Best (strongest) bullish status present, or null. */
  strongest: string | null
  /** Sum of known holding USD across bullish wallets; null when none known. */
  bullishHoldingUsd: number | null
  /** Preset-day freshnessn TTL applied. */
  ttlMs: number
  /** Metadata for the decision record. */
  source: string
}

const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000 // classification older than 48h is stale

/**
 * Fetch smart-money evidence for a token.
 * Never throws: a DB failure returns an empty, explicitly-sourced result
 * (absent evidence != no evidence — callers must treat empty as UNKNOWN).
 */
export async function getSmartMoneyEvidence(
  contract: string,
  chain: string,
  opts: { ttlMs?: number } = {},
): Promise<SmartMoneyEvidence> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const empty: SmartMoneyEvidence = {
    contract,
    chain,
    buyers: [],
    walletsHolding: 0,
    byStatus: {},
    strongest: null,
    bullishHoldingUsd: null,
    ttlMs,
    source: 'wallet-db:smartMoneyWallet',
  }
  try {
    const token = await prisma.token.findFirst({
      where: { address: contract, chain },
      select: {
        id: true,
        holdings: {
          select: {
            usdValue: true,
            wallet: {
              select: {
                id: true,
                address: true,
                alias: true,
                smartMoneyWallet: {
                  select: { status: true, pnl30d: true, winRate: true, sampleCount: true, classifiedAt: true },
                },
              },
            },
          },
          orderBy: { usdValue: 'desc' },
          take: 200,
        },
      },
    })
    if (!token) return empty

    const nowMs = Date.now()
    const evaluated: WalletBuyer[] = token.holdings.map((h) => {
      const c = h.wallet.smartMoneyWallet
      const classifiedAt = c?.classifiedAt ?? null
      const stale = classifiedAt == null ? true : nowMs - classifiedAt.getTime() > ttlMs
      return {
        walletId: h.wallet.id,
        address: h.wallet.address,
        alias: h.wallet.alias,
        status: c?.status ?? null,
        pnl30d: c?.pnl30d ?? null,
        winRate: c?.winRate ?? null,
        sampleCount: c?.sampleCount ?? 0,
        classifiedAt,
        holdingUsd: h.usdValue > 0 ? h.usdValue : null,
        stale,
      }
    })

    const bullish = evaluated.filter(
      (w) => !w.stale && w.status != null && (BULLISH_STATUSES as readonly string[]).includes(w.status),
    )
    const byStatus: Record<string, number> = {}
    for (const w of bullish) byStatus[w.status as string] = (byStatus[w.status as string] ?? 0) + 1
    const strongest = BULLISH_STATUSES.find((s) => (byStatus[s] ?? 0) > 0) ?? null
    const known = bullish.map((w) => w.holdingUsd).filter((v): v is number => v !== null)

    return {
      contract,
      chain,
      buyers: bullish,
      walletsHolding: evaluated.length,
      byStatus,
      strongest,
      bullishHoldingUsd: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
      ttlMs,
      source: 'wallet-db:smartMoneyWallet',
    }
  } catch {
    return empty
  }
}

export interface SmartMoneyGate {
  /** 'pass' when bullish evidence exists; 'warn' when absent; never 'reject' alone. */
  verdict: 'pass' | 'warn'
  reason: string
  strongest: string | null
  bullishCount: number
}

/**
 * Smart-money is CONFIRMING evidence, not a hard gate: its absence
 * downgrades a candidate to WATCHLIST but never by itself rejects a
 * token (security failures do that). Pure.
 */
export function evaluateSmartMoneyGate(ev: SmartMoneyEvidence): SmartMoneyGate {
  const bullishCount = ev.buyers.length
  if (bullishCount > 0) {
    return {
      verdict: 'pass',
      reason: `${bullishCount} classified buyer(s); strongest=${ev.strongest}`,
      strongest: ev.strongest,
      bullishCount,
    }
  }
  return {
    verdict: 'warn',
    reason: ev.walletsHolding === 0 ? 'no classified wallet holds this token' : 'classified holders are not bullish or are stale',
    strongest: null,
    bullishCount: 0,
  }
}