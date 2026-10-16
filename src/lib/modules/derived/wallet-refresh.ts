// ─────────────────────────────────────────────────────────────
// Incremental wallet refresh — daily batch job.
// Harvest → FIFO episodes → whale evidence → classify → persist.
// Read-only against Solana RPC; DB writers are
// persistWalletClassification (SmartMoneyWallet upsert) and, only when the
// operator opts in, persistSolanaTransactions (Transaction upsert).
// Re-run safe: classification is idempotent (same input -> same row),
// Wallet.lastSeen only moves forward, Transaction upsert is keyed by
// (chain, txHash).
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import {
  harvestWallet,
  SOL_MINT,
  type HarvestCoverage,
  type NormalizedSwap,
  type RpcSig,
} from '@/lib/modules/derived/solana-harvest'
import { fetchWalletActivity } from '@/lib/modules/derived/wallet-activity'
import { fetchHistoricalTokenUsd } from '@/lib/modules/derived/historical-price'
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
const BATCH_SIZE = 20
// Per-wallet signature cap. 1000 @ 650ms ≈ 11 min/wallet (measured
// 2026-10-12), so a full batch could never finish one run; 200 keeps
// each wallet ~4-5 min and still yields 10-30 trades to classify.
const HARVEST_LIMIT = 200
const THROTTLE_MS = 650
const STALE_MS = 24 * 60 * 60 * 1000 // reclassify after 24h
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Cluster/wash-trade data is NOT produced by the free public RPC path.
 * Default false so the classifier records the limitation; an operator with
 * a real cluster source can turn it on, and a future source that actually
 * produces cluster data should OR its availability in here.
 */
export function resolveClusterDataAvailable(): boolean {
  return (process.env.CLUSTER_DATA_AVAILABLE ?? '').trim().toLowerCase() === 'true'
}

/**
 * Which wallet swap source the refresh should prefer. `gmgn` (the keyless
 * wallet-activity feed) is the default because it carries real timestamps,
 * mints and trade-time USD; `rpc` forces the legacy public-RPC harvest.
 * Any other value falls back to `gmgn` so a misconfigured env never
 * silently disables the preferred source.
 */
export function resolveWalletActivitySource(): 'gmgn' | 'rpc' {
  const value = (process.env.WALLET_ACTIVITY_SOURCE ?? '').trim().toLowerCase()
  return value === 'rpc' ? 'rpc' : 'gmgn'
}

/**
 * Fill the SOL leg of a COMPLETE GMGN-sourced buy with a historical USD
 * price. Only the exact `stalePrice-current-only` limitation is cleared,
 * and only when the oracle actually returns a number — if the oracle comes
 * back null the flag stays so `classifyBuy`/`swapToTransactionRow` keep
 * rejecting the leg. Returns true when a number was applied.
 */
export function applyHistoricalUsdToSwap(
  swap: NormalizedSwap,
  historicalUsd: number | null,
): boolean {
  if (historicalUsd === null || !Number.isFinite(historicalUsd) || historicalUsd <= 0) return false
  if (swap.completeness !== 'complete') return false
  if (swap.inputMint !== SOL_MINT) return false
  swap.inputUsd = historicalUsd * swap.inputAmount
  swap.outputUsd = historicalUsd * swap.inputAmount
  swap.source = `${swap.source}+geckoterminal`
  const i = swap.limitations.indexOf('stalePrice-current-only')
  if (i >= 0) swap.limitations.splice(i, 1)
  return true
}

/**
 * 7d transaction cadence from harvested signature timestamps.
 *
 * HONESTY: this is the COUNT of harvested signatures whose blockTime is
 * >= now-7d. The signature list is capped by HARVEST_LIMIT, so the number
 * is a PROVEN LOWER BOUND — never an exact on-chain 7d total. Callers must
 * combine it with isTx7dTruncated() before presenting it.
 */
export function countSignaturesLast7d(sigs: RpcSig[], nowMs: number): number {
  const cutoff = nowMs - SEVEN_DAYS_MS
  let count = 0
  for (const sig of sigs) {
    if (sig.blockTime !== null && sig.blockTime * 1000 >= cutoff) count++
  }
  return count
}

/**
 * True when the tx7d figure above may under-count the real 7d cadence:
 * either the signature list hit the per-wallet cap before exhausting the
 * wallet's history, or the oldest harvested signature is still inside the
 * 7d window (the window was never fully walked).
 */
export function isTx7dTruncated(
  coverage: Pick<HarvestCoverage, 'truncated' | 'signatures'>,
  nowMs: number,
): boolean {
  if (coverage.truncated) return true
  const sigs = coverage.signatures ?? []
  // No signatures at all proves nothing about the last-7d cadence.
  if (sigs.length === 0) return true
  const cutoff = nowMs - SEVEN_DAYS_MS
  // Not truncated only when the harvest actually walked PAST the 7d
  // boundary (at least one signature older than now-7d exists).
  return !sigs.some((s) => s.blockTime !== null && s.blockTime * 1000 < cutoff)
}

/**
 * Pure Solana `Transaction` row mapping for ONE proven swap leg.
 * Only COMPLETE swaps with non-null historical USD qualify; token symbols
 * are unknown from the parser, so they are deliberately '' (never invented).
 * Returns null for anything that cannot be proven.
 *
 * Both BUY (SOL→token) and SELL (token→SOL) legs are eligible: the harvest
 * already produces both (GMGN wallet_activity maps sell legs too), and a
 * sell leg is required to close a round-trip episode downstream. A buy has
 * side="buy" + tokenAddress=outputMint; a sell has side="sell" +
 * tokenAddress=inputMint (the token being sold).
 */
export interface SolanaTransactionRow {
  walletId: string
  chain: 'solana'
  txHash: string
  value: number
  amountUsd: number
  tokenSymbol: string
  tokenAddress: string
  timestamp: Date
  side: 'buy' | 'sell'
  feeUsd: number | null
}

export function swapToTransactionRow(swap: NormalizedSwap, walletId = ''): SolanaTransactionRow | null {
  // Same discipline as classifyBuy / buildBuyVolume30d: current-price legs
  // are not cost basis and partial legs cannot prove their size.
  if (swap.completeness !== 'complete') return null
  if (swap.inputUsd === null) return null
  if (swap.timestamp === null || !Number.isFinite(swap.timestamp) || swap.timestamp <= 0) return null
  if (
    swap.limitations.includes('stalePrice-current-only') ||
    swap.limitations.includes('historical-usd-unavailable')
  ) {
    return null
  }

  // BUY: SOL/quote → token. The known leg's USD is the buy cost.
  if (swap.inputMint === SOL_MINT) {
    if (!swap.outputMint || swap.outputMint === SOL_MINT) return null
    return {
      walletId,
      chain: 'solana',
      txHash: swap.transactionSignature,
      value: swap.inputUsd,
      amountUsd: swap.inputUsd,
      tokenSymbol: '', // unknown from public RPC — never fabricated
      tokenAddress: swap.outputMint,
      timestamp: new Date(swap.timestamp),
      side: 'buy',
      feeUsd: swap.feeUsd,
    }
  }

  // SELL: token → SOL/quote. The known leg's USD is the proceeds.
  if (swap.outputMint === SOL_MINT) {
    if (!swap.inputMint || swap.inputMint === SOL_MINT) return null
    return {
      walletId,
      chain: 'solana',
      txHash: swap.transactionSignature,
      value: swap.inputUsd,
      amountUsd: swap.inputUsd,
      tokenSymbol: '',
      tokenAddress: swap.inputMint,
      timestamp: new Date(swap.timestamp),
      side: 'sell',
      feeUsd: swap.feeUsd,
    }
  }

  // token→token swaps: not a SOL leg, skip (same as before).
  return null
}

export function isSolanaTransactionPersistEnabled(): boolean {
  return (process.env.PERSIST_SOLANA_TRANSACTIONS ?? '').trim().toLowerCase() === 'true'
}

export interface SolanaTransactionPersistResult {
  enabled: boolean
  dryRun: boolean
  /** Proven swap legs eligible for a Transaction row (buy or sell). */
  eligible: number
  persisted: number
  failed: number
}

/**
 * Idempotent, failure-isolated ingest of verified Solana swap legs into the
 * Transaction table. Gated behind PERSIST_SOLANA_TRANSACTIONS (default
 * false): without it, this is a dry-run that only reports what WOULD be
 * persisted. Upsert key = (chain, txHash) → re-runs never double-insert.
 */
export async function persistSolanaTransactions(
  walletId: string,
  swaps: NormalizedSwap[],
): Promise<SolanaTransactionPersistResult> {
  const enabled = isSolanaTransactionPersistEnabled()
  const eligible = swaps.filter((s) => swapToTransactionRow(s, walletId) !== null).length
  if (!enabled) {
    return { enabled: false, dryRun: true, eligible, persisted: 0, failed: 0 }
  }
  let persisted = 0
  let failed = 0
  for (const swap of swaps) {
    const row = swapToTransactionRow(swap, walletId)
    if (!row) continue
    try {
      await prisma.transaction.upsert({
        where: { chain_txHash: { chain: row.chain, txHash: row.txHash } },
        create: row,
        update: {
          value: row.value,
          amountUsd: row.amountUsd,
          tokenAddress: row.tokenAddress,
          tokenSymbol: row.tokenSymbol,
          timestamp: row.timestamp,
          side: row.side,
          feeUsd: row.feeUsd,
        },
      })
      persisted++
    } catch (e) {
      // One bad row must never take down the classification batch.
      failed++
      console.warn(
        `[wallet-refresh] Solana Transaction upsert failed for ${row.txHash.slice(0, 12)}: ` +
          `${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
      )
    }
  }
  return { enabled: true, dryRun: false, eligible, persisted, failed }
}

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
  /** Honest 7d cadence lower-bound (see countSignaturesLast7d). */
  tx7d?: {
    count: number
    truncated: boolean
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

/** Raw DB shape fed into the pure candidate selector. */
export interface WalletRefreshCandidateRow {
  id: string
  address: string
  chain: string
  classifiedAt: Date | null
  lastSeen: Date
  reason?: string
}

export interface SelectRefreshCandidatesOptions {
  batchSize: number
  staleMs: number
  nowMs: number
}

// EVM-style rows (0x…) are mislabeled 'solana' in some imports — the
// Solana RPC cannot serve them. Skip non-base58 BEFORE any slot is consumed.
const BASE58_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/**
 * Pure, Prisma-free candidate selection.
 *
 * Selection contract:
 *  1. Drop non-base58 addresses FIRST — an `0x…` row must never consume a slot.
 *  2. Never-classified (classifiedAt == null) wallets first, ordered by
 *     `lastSeen desc` (tiebreak: `id asc` for determinism), up to batchSize.
 *  3. Fill remaining slots with stale classified wallets (classifiedAt older
 *     than staleMs), oldest classification first (tiebreak: `id asc`).
 *  4. Fresh classified wallets are excluded.
 */
export function selectRefreshCandidates(
  rows: WalletRefreshCandidateRow[],
  opts: SelectRefreshCandidatesOptions,
): WalletRefreshCandidate[] {
  const { batchSize, staleMs, nowMs } = opts
  const base58Rows = rows.filter((r) => BASE58_ADDR_RE.test(r.address))

  const neverClassified = base58Rows
    .filter((r) => r.classifiedAt == null)
    .sort(
      (a, b) =>
        b.lastSeen.getTime() - a.lastSeen.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

  const staleClassified = base58Rows
    .filter((r) => r.classifiedAt != null && nowMs - r.classifiedAt.getTime() > staleMs)
    .sort(
      (a, b) =>
        a.classifiedAt!.getTime() - b.classifiedAt!.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

  const neverPicked = neverClassified.slice(0, batchSize)
  const remaining = batchSize - neverPicked.length
  const toCandidate = (row: WalletRefreshCandidateRow): WalletRefreshCandidate => ({
    walletId: row.id,
    address: row.address,
    chain: row.chain,
    classifiedAt: row.classifiedAt,
    reason: row.classifiedAt == null ? 'never-classified' : 'stale-classification',
  })
  return [
    ...neverPicked.map(toCandidate),
    ...staleClassified.slice(0, Math.max(0, remaining)).map(toCandidate),
  ]
}

/**
 * Wallets needing classification: never classified, or stale >24h.
 *
 * The Prisma filter does the classification gate up-front so a flood of
 * fresh-classified wallets (e.g. 426 GMGN rows with fresh `lastSeen`) never
 * crowds out never-classified wallets. The pure selector then applies the
 * base58 filter and pool ordering without any further DB truncation.
 */
export async function getRefreshCandidates(): Promise<WalletRefreshCandidate[]> {
  const nowMs = Date.now()
  const staleCutoff = new Date(nowMs - STALE_MS)
  const rows = await prisma.wallet.findMany({
    where: {
      chain: 'solana',
      OR: [
        { smartMoneyWallet: { is: null } },
        { smartMoneyWallet: { classifiedAt: { lt: staleCutoff } } },
      ],
    },
    select: {
      id: true,
      address: true,
      chain: true,
      lastSeen: true,
      smartMoneyWallet: { select: { classifiedAt: true } },
    },
    orderBy: { lastSeen: 'desc' },
  })
  return selectRefreshCandidates(
    rows.map((w) => ({
      id: w.id,
      address: w.address,
      chain: w.chain,
      classifiedAt: w.smartMoneyWallet?.classifiedAt ?? null,
      lastSeen: w.lastSeen,
    })),
    { batchSize: BATCH_SIZE, staleMs: STALE_MS, nowMs },
  )
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
    const historical =
      s.inputUsd !== null &&
      !s.limitations.includes('stalePrice-current-only') &&
      !s.limitations.includes('historical-usd-unavailable')
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

/**
 * Fill complete SOL→token GMGN legs whose trade-time USD is missing or
 * stale with the keyless GeckoTerminal OHLCV oracle. Only the stale flag is
 * cleared and only when a real number comes back — never weaken the gate.
 */
async function fillHistoricalUsdForSwaps(swaps: NormalizedSwap[]): Promise<void> {
  for (const swap of swaps) {
    if (swap.completeness !== 'complete') continue
    if (swap.inputMint !== SOL_MINT) continue
    if (!swap.outputMint || swap.outputMint === SOL_MINT) continue
    if (swap.inputUsd !== null && !swap.limitations.includes('stalePrice-current-only')) continue
    if (swap.timestamp === null || !Number.isFinite(swap.timestamp) || swap.timestamp <= 0) continue
    const price = await fetchHistoricalTokenUsd(swap.outputMint, swap.timestamp)
    applyHistoricalUsdToSwap(swap, price.usd)
  }
}

// ─── Refresh one wallet ──────────────────────────────────────

export async function refreshOneWallet(candidate: WalletRefreshCandidate): Promise<RefreshResult> {
  try {
    const source = resolveWalletActivitySource()
    let swaps: NormalizedSwap[]
    let coverage: { sigsSeen: number; validEvents: number; rejectedEvents: number; gaps: string[]; complete30d: boolean; truncated?: boolean; signatures?: RpcSig[] }
    let sigs: RpcSig[]

    if (source === 'rpc') {
      const harvested = await harvestWallet(candidate.address, {
        days: REFRESH_WINDOW_DAYS,
        // Per-wallet cap (see HARVEST_LIMIT): measured 1.6-2.4s/signature
        // live, so 200 sigs ≈ 4-5 min/wallet — enough trades to classify
        // while keeping one batch inside a cron slot.
        limit: HARVEST_LIMIT,
        withUsd: true,
        throttleMs: THROTTLE_MS,
      })
      swaps = harvested.swaps
      coverage = harvested.coverage
      sigs = harvested.coverage.signatures
    } else {
      // Preferred: keyless GMGN wallet activity — real timestamps, mints and
      // trade-time USD. Falls back to the public-RPC harvest (inside
      // fetchWalletActivity) only when GMGN returns no usable swaps, so a
      // wallet with an empty GMGN feed still gets its legacy harvest.
      const activity = await fetchWalletActivity(candidate.address, { limit: HARVEST_LIMIT })
      if (activity.source === 'gmgn' && activity.swaps.length > 0) {
        // GMGN rows are COMPLETE but may still carry a null trade-time USD
        // (or a current-only fill from upstream). Fill the SOL leg with the
        // keyless GeckoTerminal OHLCV oracle — and only clear the stale flag
        // when that oracle returns a real number.
        await fillHistoricalUsdForSwaps(activity.swaps)
      }
      swaps = activity.swaps
      coverage = {
        sigsSeen: activity.coverage.sigsSeen,
        validEvents: activity.coverage.validEvents,
        rejectedEvents: Math.max(0, activity.coverage.sigsSeen - activity.coverage.validEvents),
        gaps: activity.coverage.gaps,
        complete30d: activity.coverage.complete,
      }
      sigs = []
    }

    const built = buildEpisodes(swaps)
    const trades = toTradeEpisodes(built.episodes)

    const nowMs = Date.now()
    const tx7d = countSignaturesLast7d(sigs, nowMs)
    const tx7dTruncated = isTx7dTruncated({ truncated: coverage.truncated === true, signatures: sigs }, nowMs)
    const clusterDataAvailable = resolveClusterDataAvailable()

    const [positions, portfolio] = await Promise.all([
      fetchPositions(candidate.address),
      buildPortfolioSnapshot(),
    ])
    const buyVol = buildBuyVolume30d(swaps, nowMs)
    const whale = buildWhaleEvidence(positions, portfolio, buyVol, null, SMART_MONEY_DEFAULTS)

    const input: ClassifyInput = {
      episodes: trades,
      whale: whale.evidence,
      // PROVEN LOWER BOUND, not an exact 7d on-chain total: the public RPC
      // signature list is capped at HARVEST_LIMIT. The truncation flag below
      // makes the classifier say "N+" instead of "N".
      tx7d,
      tx7dTruncated,
      distinctTokensTraded: new Set(trades.map((t) => t.token)).size,
      feeComplete: trades.length > 0 && trades.every((t) => t.feeKnown),
      // Public RPC does NOT provide cluster/wash-trade data. Default false
      // (operator can opt in via CLUSTER_DATA_AVAILABLE) so the limitation
      // is recorded rather than silently assuming clean trades.
      clusterDataAvailable,
    }
    const out = classifyWallet(input)
    const status = await persistWalletClassification(candidate.walletId, input)

    // Audit item #6: only persist verified buy legs, gated by operator opt-in.
    const txPersist = await persistSolanaTransactions(candidate.walletId, swaps)
    if (txPersist.dryRun) {
      console.log(
        `[wallet-refresh] Solana tx persist dry-run for ${candidate.address.slice(0, 8)}: ` +
          `${txPersist.eligible} eligible of ${swaps.length} swaps — set PERSIST_SOLANA_TRANSACTIONS=true to write`,
      )
    }

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
      tx7d: { count: tx7d, truncated: tx7dTruncated },
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
