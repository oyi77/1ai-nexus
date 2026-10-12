// ─────────────────────────────────────────────────────────────
// Incremental wallet refresh — daily batch job.
// Harvest → FIFO episodes → whale evidence → classify → persist.
// Read-only against Solana RPC; single DB writer is
// persistWalletClassification (SmartMoneyWallet upsert).
// Re-run safe: classification is idempotent (same input -> same row),
// Wallet.lastSeen only moves forward.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { harvestWallet, SOL_MINT, type NormalizedSwap } from '@/lib/modules/derived/solana-harvest'
import { buildEpisodes, toTradeEpisodes } from '@/lib/modules/derived/wallet-episodes'
import { classifyWallet, SMART_MONEY_DEFAULTS, type ClassifyInput } from '@/lib/modules/derived/wallet-intel'
import { persistWalletClassification } from '@/lib/modules/derived/wallet-classifier'
import {
  buildWhaleEvidence,
  type PositionSnapshot,
  type PortfolioSnapshot,
  type BuyVolume30dInput,
} from '@/lib/modules/derived/whale-evidence'

// ─── Config ──────────────────────────────────────────────────
const REFRESH_WINDOW_DAYS = 30
const BATCH_SIZE = 5
// Per-wallet signature cap. 1000 @ 650ms ≈ 11 min/wallet (measured
// 2026-10-12), so a full batch could never finish one run; 200 keeps
// each wallet ~4-5 min and still yields 10-30 trades to classify.
const HARVEST_LIMIT = 200
const THROTTLE_MS = 650
const STALE_MS = 24 * 60 * 60 * 1000 // reclassify after 24h

// ─── Types ───────────────────────────────────────────────────
export interface WalletRefreshCandidate {
  walletId: string
  address: string
  chain: string
  classifiedAt: Date | null
  reason: string
}

export interface RefreshResult {
  walletId: string
  address: string
  success: boolean
  error?: string
  coverage?: {
    sigsSeen: number
    validEvents: number
    rejectedEvents: number
    gaps: string[]
    complete30d: boolean
  }
  classification?: {
    status: string
    pnl30d: number | null
    winRate: number | null
    episodesUsed: number
    confidence: string
  }
  whaleGates?: Record<string, boolean>
  /** Complete swaps from this harvest, reused by wallet discovery. */
  freshSwaps?: NormalizedSwap[]
}

export interface RefreshSummary {
  candidates: number
  processed: number
  succeeded: number
  failed: number
  results: RefreshResult[]
  /**
   * Harvested swaps for downstream discovery. The batch already paid the
   * RPC cost; sniper-scan re-folds these into WHALE_ACTIVITY candidates
   * without another harvest (shared with foldWalletBuys).
   */
  swapsByWallet: Array<{ wallet: string; swaps: unknown[] }>
}

// ─── Candidates ──────────────────────────────────────────────

/** Wallets needing classification: never classified, or stale >24h. */
export async function getRefreshCandidates(): Promise<WalletRefreshCandidate[]> {
  const rows = await prisma.wallet.findMany({
    where: { chain: 'solana' },
    select: {
      id: true,
      address: true,
      chain: true,
      smartMoneyWallet: { select: { classifiedAt: true } },
    },
    orderBy: { lastSeen: 'desc' },
    take: BATCH_SIZE * 10,
  })
  // EVM-style rows (0x…) are mislabeled 'solana' in some imports — the
  // Solana RPC cannot serve them. Skip non-base58 here, not after a harvest.
  const isBase58Addr = (a: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)
  const nowMs = Date.now()
  return rows
    .map((w) => ({
      walletId: w.id,
      address: w.address,
      chain: w.chain,
      classifiedAt: w.smartMoneyWallet?.classifiedAt ?? null,
      reason: w.smartMoneyWallet?.classifiedAt == null ? 'never-classified' : 'stale-classification',
    }))
    .filter((c) => isBase58Addr(c.address))
    .filter((c) => c.classifiedAt == null || nowMs - c.classifiedAt.getTime() > STALE_MS)
    .slice(0, BATCH_SIZE)
}

// ─── Evidence helpers ────────────────────────────────────────

/**
 * Current token positions. USD is NOT invented here: valueUsd stays
 * null (current price is not historical cost basis); completeness
 * marks the evidence partial/current-only.
 */
export async function fetchPositions(wallet: string): Promise<PositionSnapshot[]> {
  try {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          wallet,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`RPC ${res.status}`)
    const j = (await res.json()) as {
      result?: { value: Array<{ account: { data: { parsed?: { info?: { mint: string; tokenAmount: { uiAmount: number | null } } } } } }> }
    }
    const out: PositionSnapshot[] = []
    for (const acc of j.result?.value ?? []) {
      const info = acc.account?.data?.parsed?.info
      if (!info) continue
      if ((info.tokenAmount?.uiAmount ?? 0) <= 0) continue
      out.push({
        mint: info.mint,
        valueUsd: null, // no historical USD -> null, never 0
        measuredAt: Date.now(),
        source: 'solana-rpc:mainnet-beta',
        completeness: 'partial',
        limitations: ['current-price-not-historical'],
      })
    }
    return out
  } catch {
    return [] // absence stays absence — never an empty "0 portfolio"
  }
}

/** Portfolio: current-only by construction; flag it explicitly. */
export async function buildPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  return {
    totalUsd: null, // cannot be proven without historical USD -> null
    measuredAt: Date.now(),
    source: 'solana-rpc:mainnet-beta',
    completeness: 'current-only',
    limitations: ['portfolio-current-only', 'no-historical-usd'],
  }
}

/**
 * 30d buy volume from harvested swaps: only COMPLETE legs that carry
 * historical USD. Partial legs cannot prove the full buy size, and
 * current-price legs are not historical — both are excluded.
 */
export function buildBuyVolume30d(swaps: NormalizedSwap[], nowMs: number): BuyVolume30dInput {
  const windowMs = 30 * 24 * 60 * 60 * 1000
  const legs: BuyVolume30dInput['legs'] = []
  for (const s of swaps) {
    const isBuy = s.inputMint === SOL_MINT && s.outputMint !== SOL_MINT
    const historical = s.inputUsd !== null && !s.limitations.includes('stalePrice-current-only')
    if (isBuy && historical && s.completeness === 'complete' && s.inputUsd !== null) {
      legs.push({
        ts: s.timestamp ?? nowMs,
        usd: s.inputUsd,
        completeness: 'complete',
        hasHistoricalUsd: true,
      })
    }
  }
  return { legs, windowMs, now: nowMs }
}

// ─── Refresh one wallet ──────────────────────────────────────

export async function refreshOneWallet(candidate: WalletRefreshCandidate): Promise<RefreshResult> {
  try {
    const { swaps, coverage } = await harvestWallet(candidate.address, {
      days: REFRESH_WINDOW_DAYS,
      // Per-wallet cap (see HARVEST_LIMIT): measured 1.6-2.4s/signature
      // live, so 200 sigs ≈ 4-5 min/wallet — enough trades to classify
      // while keeping one batch inside a cron slot.
      limit: HARVEST_LIMIT,
      withUsd: true,
      throttleMs: THROTTLE_MS,
    })

    const built = buildEpisodes(swaps)
    const trades = toTradeEpisodes(built.episodes)

    const [positions, portfolio] = await Promise.all([
      fetchPositions(candidate.address),
      buildPortfolioSnapshot(),
    ])
    const buyVol = buildBuyVolume30d(swaps, Date.now())
    const whale = buildWhaleEvidence(positions, portfolio, buyVol, null, SMART_MONEY_DEFAULTS)

    const input: ClassifyInput = {
      episodes: trades,
      whale: whale.evidence,
      tx7d: null,
      distinctTokensTraded: new Set(trades.map((t) => t.token)).size,
      feeComplete: trades.length > 0 && trades.every((t) => t.feeKnown),
      clusterDataAvailable: false,
    }
    const out = classifyWallet(input)
    const status = await persistWalletClassification(candidate.walletId, input)

    await prisma.wallet.update({
      where: { id: candidate.walletId },
      data: { lastSeen: new Date() },
    })

    return {
      walletId: candidate.walletId,
      address: candidate.address,
      success: true,
      coverage: {
        sigsSeen: coverage.sigsSeen,
        validEvents: coverage.validEvents,
        rejectedEvents: coverage.rejectedEvents,
        gaps: coverage.gaps,
        complete30d: coverage.complete30d,
      },
      classification: {
        status,
        pnl30d: out.pnl30d,
        winRate: out.winRate,
        episodesUsed: out.episodesUsed,
        confidence: out.confidence,
      },
      whaleGates: whale.gates as unknown as Record<string, boolean>,
      // The harvest is the expensive part: hand the swaps to discovery so it
      // re-folds them into wallet-buy candidates with no second RPC call.
      freshSwaps: swaps.filter((x) => x.completeness === 'complete'),
    }
  } catch (e) {
    return {
      walletId: candidate.walletId,
      address: candidate.address,
      success: false,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    }
  }
}

// ─── Batch ───────────────────────────────────────────────────

export async function runWalletRefreshBatch(): Promise<RefreshSummary> {
  const candidates = await getRefreshCandidates()
  const results: RefreshResult[] = []
  const allSwaps: Array<{ wallet: string; swaps: unknown[] }> = []
  for (const c of candidates) {
    const r = await refreshOneWallet(c)
    results.push(r)
    if (r.success && r.freshSwaps && r.freshSwaps.length > 0) {
      allSwaps.push({ wallet: c.address, swaps: r.freshSwaps })
    }
  }
  return {
    candidates: candidates.length,
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
    swapsByWallet: allSwaps,
  }
}
