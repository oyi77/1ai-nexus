// ─────────────────────────────────────────────────────────────
// Wallet activity enrichment — swaps with REAL timestamps + token mints.
//
// Problem (documented in solana-harvest.ts): the free public RPC answers
// 429 under load and increasingly returns null transaction bodies, so the
// on-chain harvest cannot be the only source of a wallet's recent swaps.
// This module tries the sources below in order and returns the BEST ONE
// (first source that returns at least one usable swap), never a merge of
// incompatible provenance.
//
// Source matrix (probed live 2026-10-14):
//   1. GMGN wallet activity
//      GET https://gmgn.ai/vas/api/v1/wallet_activity/sol
//          ?wallet=<addr>&limit=<n>&cost=10
//      Keyless with curl transport (same UA/Referer/cookie as gmgnFetch).
//      Rows carry real epoch-seconds timestamps, token mint, side
//      (buy/sell), token_amount, quote_amount, cost_usd (historical at
//      trade time), price_usd, and fee fields. This is the preferred
//      source when it answers.
//   2. Helius enhanced RPC (only when HELIUS_API_KEY is set)
//      getSignaturesForAddress + getTransaction via RPC with an API key.
//      Higher quota than the free endpoint; body shape identical.
//   3. Public Solana RPC fallback (harvestWallet, no historical USD).
//
// NOT sources (probed live 2026-10-14, keyless):
//   - Solscan v2  https://api-v2.solscan.io/v2/account/transaction
//     403 Cloudflare challenge even with browser UA + Origin/Referer.
//   - api.solscan.io — DNS no longer resolves.
//   - Birdeye public-api https://public-api.birdeye.so/v1/wallet/*
//     401 Unauthorized without x-api-key.
//   - Birdeye forge    https://birdeye.so/forge/solana/wallet/{addr}/txs
//     404 Not found (no such route).
//   - Axiom.trade — no operator cookie/API key present; skipped.
//
// NEVER FABRICATES: missing mints stay '', missing timestamps stay null,
// missing USD stays null. A row that lacks any of {mint, amount, side,
// timestamp} is either rejected (documented) or returned partial.
// ─────────────────────────────────────────────────────────────

import {
  SOL_MINT,
  harvestWallet,
  parseSolanaTransaction,
  type NormalizedSwap,
} from '@/lib/modules/derived/solana-harvest'
import { normalizeSolMint } from '@/lib/modules/derived/solana-mint'
import { gmgnFetch } from '@/lib/modules/meme/gmgn'

export interface WalletActivityCoverage {
  sigsSeen: number
  validEvents: number
  complete: boolean
  gaps: string[]
}

export interface WalletActivityResult {
  source: string
  swaps: NormalizedSwap[]
  coverage: WalletActivityCoverage
  note?: string
}

export interface GmgnActivityRow {
  wallet?: string
  chain?: string
  tx_hash?: string
  timestamp?: number
  event_type?: string
  token?: { address?: string; symbol?: string }
  token_amount?: string | number
  quote_amount?: string | number
  cost_usd?: string | number
  buy_cost_usd?: string | number
  price_usd?: string | number
  price?: string | number
  is_open_or_close?: number
  quote_token?: { token_address?: string; symbol?: string; decimals?: number }
  quote_address?: string
  gas_native?: string | number
  gas_usd?: string | number
  dex_native?: string | number
  dex_usd?: string | number
  priority_fee?: string | number
  tip_fee?: string | number
  launchpad?: string
}

const GMGN_ACTIVITY_BASE = 'https://gmgn.ai/vas/api/v1/wallet_activity'
const HELIUS_RPC = 'https://mainnet.helius-rpc.com'

/** Injectable fetch seam for tests (defaults to global fetch). */
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>
let fetchFn: FetchFn | null = null
export function __setWalletActivityFetchForTests(fn: FetchFn | null): void {
  fetchFn = fn
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** Epoch seconds → epoch ms; null for missing/future-garbage values. */
export function toEpochMs(seconds: number | null | undefined, nowMs = Date.now()): number | null {
  if (seconds === null || seconds === undefined) return null
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  const ms = seconds * 1000
  // A timestamp more than one hour in the future is a data error, not a
  // real block time — keep it null instead of poisoning the classifier.
  if (ms > nowMs + 3_600_000) return null
  return ms
}

/**
 * Map one GMGN wallet_activity row → one NormalizedSwap. Pure.
 *
 * Direction is inferred from the row's `event_type`:
 *   buy  → SOL/quote → token
 *   sell → token     → SOL/quote
 * Any other event type is returned as a rejected event so the count is
 * still visible (never silently dropped).
 */
export function mapGmgnActivityToSwap(wallet: string, row: GmgnActivityRow, nowMs = Date.now()): NormalizedSwap {
  const base = {
    chain: 'solana' as const,
    walletAddress: wallet,
    transactionSignature: row.tx_hash ?? '',
    timestamp: toEpochMs(row.timestamp, nowMs),
    source: 'gmgn:wallet_activity',
    limitations: [] as string[],
  }
  const event = (row.event_type ?? '').toLowerCase()
  const tokenMint = row.token?.address ?? ''
  const quoteMint = normalizeSolMint(row.quote_token?.token_address ?? row.quote_address ?? SOL_MINT)
  const tokenAmount = num(row.token_amount)
  const quoteAmount = num(row.quote_amount)

  const reject = (reason: string): NormalizedSwap => ({
    ...base,
    inputMint: '',
    outputMint: '',
    inputAmount: 0,
    outputAmount: 0,
    inputUsd: null,
    outputUsd: null,
    feeNative: null,
    feeUsd: null,
    feeKnown: false,
    completeness: 'rejected',
    rejectReason: reason,
    limitations: [reason],
  })

  if (!base.transactionSignature) return reject('missing-tx-hash')
  if (base.timestamp === null) return reject('missing-timestamp')
  if (!tokenMint) return reject('missing-token-mint')
  if (tokenAmount === null || !(tokenAmount > 0)) return reject('nonpositive-token-amount')
  if (!event || !['buy', 'sell'].includes(event)) return reject(`unsupported-event-type:${event || 'empty'}`)

  // USD (GMGN reports trade-time USD): inputUsd is the known leg's USD.
  // For a sell, cost_usd is proceeds; for a buy, cost_usd is the cost.
  const costUsd = num(row.cost_usd)
  const feeUsd = num(row.gas_usd)
  const limitations: string[] = []
  if (costUsd === null) limitations.push('missing-usd')
  const feeNative = num(row.gas_native)
  const feeKnown = feeNative !== null
  if (!feeKnown) limitations.push('missing-fee')
  if (row.chain && row.chain !== 'sol') limitations.push(`gmgn-chain:${row.chain}`)

  if (event === 'buy') {
    if (quoteAmount !== null && !(quoteAmount > 0)) limitations.push('nonpositive-quote-amount')
    return {
      ...base,
      inputMint: quoteMint,
      outputMint: tokenMint,
      inputAmount: quoteAmount ?? 0,
      outputAmount: tokenAmount,
      inputUsd: costUsd,
      outputUsd: costUsd,
      feeNative,
      feeUsd,
      feeKnown,
      completeness: 'complete',
      limitations,
    }
  }
  // sell
  return {
    ...base,
    inputMint: tokenMint,
    outputMint: quoteMint,
    inputAmount: tokenAmount,
    outputAmount: quoteAmount ?? 0,
    inputUsd: costUsd,
    outputUsd: costUsd,
    feeNative,
    feeUsd,
    feeKnown,
    completeness: 'complete',
    limitations,
  }
}

interface GmgnActivityResponse {
  code?: number
  data?: { activities?: GmgnActivityRow[]; next?: string }
}

async function fetchGmgnActivity(
  wallet: string,
  limit: number,
  minBlockTime?: number,
): Promise<{ swaps: NormalizedSwap[]; coverage: WalletActivityCoverage }> {
  const gaps: string[] = []
  let rows: GmgnActivityRow[] = []
  try {
    const res = await gmgnFetch<GmgnActivityResponse>(
      `${GMGN_ACTIVITY_BASE}/sol?wallet=${encodeURIComponent(wallet)}&limit=${Math.min(Math.max(limit, 1), 50)}&cost=10`,
    )
    if (res.code !== 0) {
      gaps.push(`gmgn-code:${String(res.code)}`)
    } else {
      rows = res.data?.activities ?? []
      if (rows.length === 0) gaps.push('gmgn-empty-activity-page')
    }
  } catch (err) {
    gaps.push(`gmgn-fetch-fail:${err instanceof Error ? err.message.slice(0, 48) : 'err'}`)
  }
  const now = Date.now()
  const minTs = minBlockTime ?? 0
  let sigsSeen = 0
  let validEvents = 0
  const out: NormalizedSwap[] = []
  for (const row of rows) {
    if (row.tx_hash) sigsSeen++
    const swap = mapGmgnActivityToSwap(wallet, row, now)
    if (swap.completeness === 'rejected') continue
    if (minTs > 0 && swap.timestamp !== null && swap.timestamp < minTs) continue
    out.push(swap)
    validEvents++
  }
  return {
    swaps: out,
    coverage: {
      sigsSeen,
      validEvents,
      complete: validEvents > 0 && out.length === rows.length,
      gaps,
    },
  }
}

async function rpcCallHelius<T>(
  method: string,
  params: unknown[],
  timeoutMs = 30_000,
): Promise<T> {
  const apiKey = process.env.HELIUS_API_KEY
  if (!apiKey) throw new Error('HELIUS_API_KEY not set')
  const f = fetchFn ?? fetch
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await f(`${HELIUS_RPC}/?api-key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Helius HTTP ${res.status}`)
    const json = (await res.json()) as { result?: T; error?: unknown }
    if (json.error) throw new Error(`Helius RPC error: ${JSON.stringify(json.error).slice(0, 140)}`)
    return json.result as T
  } finally {
    clearTimeout(t)
  }
}

async function fetchHeliusActivity(
  wallet: string,
  limit: number,
  minBlockTime?: number,
): Promise<{ swaps: NormalizedSwap[]; coverage: WalletActivityCoverage }> {
  const gaps: string[] = []
  if (!process.env.HELIUS_API_KEY) return { swaps: [], coverage: { sigsSeen: 0, validEvents: 0, complete: false, gaps: ['helius-key-unset'] } }
  const swaps: NormalizedSwap[] = []
  let sigsSeen = 0
  let validEvents = 0
  try {
    const sigs = await rpcCallHelius<Array<{ signature: string; blockTime: number | null }>>(
      'getSignaturesForAddress',
      [wallet, { limit: Math.min(Math.max(limit, 1), 100) }],
    )
    sigsSeen = sigs.length
    for (const sig of sigs) {
      if (minBlockTime && sig.blockTime !== null && sig.blockTime * 1000 < minBlockTime) continue
      try {
        const tx = await rpcCallHelius<{ blockTime: number | null; meta?: unknown; transaction?: unknown }>(
          'getTransaction',
          [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        )
        // parseSolanaTransaction has no optional-arg overload for null tx:
        // a null body is an honest gap and must not be forced into a swap.
        if (!tx || !tx.meta || !tx.transaction) {
          gaps.push(`helius-tx-null:${sig.signature.slice(0, 8)}`)
          continue
        }
        const parsed = parseSolanaTransaction(wallet, sig.signature, {
          blockTime: tx.blockTime,
          meta: tx.meta as Parameters<typeof parseSolanaTransaction>[2]['meta'],
          transaction: tx.transaction as Parameters<typeof parseSolanaTransaction>[2]['transaction'],
        })
        for (const ev of parsed) {
          if (ev.completeness === 'rejected') continue
          swaps.push(ev)
          validEvents++
        }
      } catch (err) {
        gaps.push(`helius-tx-fail:${sig.signature.slice(0, 8)}:${err instanceof Error ? err.message.slice(0, 32) : 'err'}`)
      }
    }
  } catch (err) {
    gaps.push(`helius-fetch-fail:${err instanceof Error ? err.message.slice(0, 64) : 'err'}`)
  }
  return { swaps, coverage: { sigsSeen, validEvents, complete: validEvents > 0 && gaps.length === 0, gaps } }
}

/**
 * Try sources in order, return the FIRST one with usable swaps.
 * If nothing works, return `{source:'none', swaps:[], ...}` with an honest
 * gaps note — never throw, never fabricate.
 */
export async function fetchWalletActivity(
  address: string,
  opts: { limit?: number; minBlockTime?: number } = {},
): Promise<WalletActivityResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)
  const minBlockTime = opts.minBlockTime

  // 1) GMGN keyless wallet activity — real timestamps + mints + trade-time USD.
  const gmgn = await fetchGmgnActivity(address, limit, minBlockTime)
  if (gmgn.swaps.length > 0) {
    return {
      source: 'gmgn',
      swaps: gmgn.swaps,
      coverage: gmgn.coverage,
      note: 'GMGN /vas/api/v1/wallet_activity — keyless, real timestamps, trade-time USD',
    }
  }

  // 2) Helius enhanced RPC (only when the operator supplied a key).
  if (process.env.HELIUS_API_KEY) {
    const helius = await fetchHeliusActivity(address, limit, minBlockTime)
    if (helius.swaps.length > 0) {
      return {
        source: 'helius',
        swaps: helius.swaps,
        coverage: helius.coverage,
        note: 'Helius enhanced RPC (getSignaturesForAddress + getTransaction)',
      }
    }
    gmgn.coverage.gaps.push(...helius.coverage.gaps)
  }

  // 3) Public Solana RPC fallback (no historical USD; real block timestamps).
  try {
    const harvested = await harvestWallet(address, { limit, days: 30 })
    const ok = harvested.swaps.filter((s) => s.completeness !== 'rejected')
    const gaps = [...harvested.coverage.gaps, ...gmgn.coverage.gaps]
    if (ok.length === 0) {
      gaps.push('solana-rpc-fallback:no-valid-swaps')
    }
    return {
      source: ok.length > 0 ? 'solana-rpc' : 'none',
      swaps: ok,
      coverage: {
        sigsSeen: harvested.coverage.sigsSeen,
        validEvents: harvested.coverage.validEvents,
        complete: harvested.coverage.complete30d && ok.length > 0,
        gaps,
      },
      note:
        ok.length > 0
          ? 'Public Solana RPC harvest — real block timestamps, no historical USD (partial swaps)'
          : 'No keyless source returned a usable swap',
    }
  } catch (err) {
    return {
      source: 'none',
      swaps: [],
      coverage: {
        sigsSeen: 0,
        validEvents: 0,
        complete: false,
        gaps: [
          ...gmgn.coverage.gaps,
          `solana-rpc-fail:${err instanceof Error ? err.message.slice(0, 64) : 'err'}`,
          'no keyless source',
        ],
      },
      note: 'No keyless source returned a usable swap',
    }
  }
}
