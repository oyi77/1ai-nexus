// ─────────────────────────────────────────────────────────────
// Wallet tracer — token → early buyers → classification → evidence.
//
// Reads the token's LARGEST token accounts on-chain (getProgramAccounts on
// the SPL Token program filtered by mint), then runs each holder through
// the existing classifier (harvest → episodes → classifyWallet) and
// returns SmartMoneyEvidence for the screening gate.
//
// Read-only against public Solana RPC. No invented PnL: a holder whose
// harvest produces no usable episodes contributes no evidence (UNKNOWN
// discipline inherited from wallet-intel). Expensive: batches are small,
// throttled, and the result is memoized per (mint, maxHolders) with a TTL
// so a scan pass reuses one trace instead of re-harvesting per candidate.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { harvestWallet, type NormalizedSwap } from '@/lib/modules/derived/solana-harvest'
import { buildEpisodes, toTradeEpisodes } from '@/lib/modules/derived/wallet-episodes'
import { classifyWallet } from '@/lib/modules/derived/wallet-intel'
import {
  BULLISH_STATUSES,
  TRACER_PNL_STATUS,
  type SmartMoneyEvidence,
  type WalletBuyer,
} from '@/lib/modules/derived/smart-money-provider'

const TTL_MS = 30 * 60 * 1000 // one trace per mint per 30 min
const THROTTLE_MS = 650
const MAX_TX_PER_HOLDER = 40
// A trace must never outlive one cron tick. The public RPC throttles
// per-method (429) and a full 12-holder harvest measured >600s, so the
// whole trace runs under a hard deadline and returns partial evidence
// (already-classified buyers) instead of stalling the scan.
const TRACE_BUDGET_MS = Number(process.env.SNIPER_TRACE_BUDGET_MS) || 20_000
const MAX_HOLDERS_PER_TRACE = 4

interface HolderRow {
  owner: string
  amount: number
  decimals: number
}

interface TraceRow {
  at: number
  evidence: SmartMoneyEvidence
}

const traceCache = new Map<string, TraceRow>()

/** Seed holder with optional PnL from a holder-list provider. */
export interface HolderSeed {
  owner: string
  amount: number
  decimals: number
  usdValue: number
  costCur: number
  unrealizedProfit: number | null
  realizedProfit: number | null
  suspicious: boolean
  tags: string[]
}

export type { HolderRow }
export type { HolderSeed as HolderSeedRow }

/**
 * Top holders for a mint. Source is switchable — GMGN holder list is the
 * default (real per-holder PnL proven live 2026-10-09, but cookie-gated
 * and Cloudflare-blocked from Node without one). Helius is the keyed
 * fallback: free tier 100k credits/mo, getTokenLargestAccounts works
 * keyless-free-tier without a browser session.
 *
 * HOLDER_SOURCE: 'gmgn' (default) | 'helius' | 'auto' (try gmgn, fall to
 * helius). Helius rows carry NO PnL — usdValue/costCur stay 0 and the
 * fast path records nothing; holders flow to the slow-path classifier
 * (harvest → episodes). Missing key/blocked endpoint → [] — never a
 * fabricated row.
 */
export type HolderSource = 'gmgn' | 'helius' | 'auto'

export function holderSource(): HolderSource {
  const v = (process.env.HOLDER_SOURCE ?? 'gmgn').toLowerCase()
  return v === 'helius' || v === 'auto' ? v : 'gmgn'
}
export async function fetchTopHolders(mint: string, limit = 25): Promise<HolderSeed[]> {
  const src = holderSource()
  if (src === 'helius') return fetchHeliusHolders(mint, limit)
  if (src === 'auto') {
    const viaGmgn = await fetchGmgnHolders(mint, limit)
    return viaGmgn.length > 0 ? viaGmgn : fetchHeliusHolders(mint, limit)
  }
  return fetchGmgnHolders(mint, limit)
}

async function fetchGmgnHolders(mint: string, limit: number): Promise<HolderSeed[]> {
  const { listGmgnTokenHolders } = await import('@/lib/modules/meme/gmgn')
  const rows = await listGmgnTokenHolders('solana', mint)
  return rows.slice(0, limit).map((h) => ({
    owner: h.address,
    amount: h.amountPercentage,
    decimals: 9,
    usdValue: h.usdValue,
    costCur: h.costCur,
    unrealizedProfit: h.unrealizedProfit,
    realizedProfit: h.realizedProfit,
    suspicious: h.suspicious,
    tags: h.tags,
  }))
}

// ─── Helius holder source ────────────────────────────────────
// Keyed RPC: getTokenLargestAccounts returns the top-20 token accounts
// (owner + raw amount). No PnL — Helius is an address source only, so
// every row flows to the slow-path classifier. Both calls are standard
// Solana JSON-RPC, so this works against Helius, a private RPC, or the
// free public endpoint (which rate-limits).

/** Parsed RPC JSON-RPC envelope (only the fields this module reads). */
interface RpcEnvelope<T> {
  result?: T
  error?: { code?: number; message?: string }
}

interface LargestAccountsResult {
  value?: Array<{ address?: string; amount?: string; uiAmountString?: string }>
}

interface ParsedAccountResult {
  value?: { data?: { parsed?: { info?: { owner?: string; decimals?: number } } } }
}

function heliusRpcUrl(): string | null {
  const key = process.env.HELIUS_API_KEY
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`
  // Keyless: any configured RPC works (public endpoint included).
  return process.env.SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URLS?.split(',')[0] ?? null
}

async function rpcCall<T>(url: string, body: unknown, timeoutMs = 15_000): Promise<T | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as RpcEnvelope<T>
    return json.result ?? null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function fetchHeliusHolders(mint: string, limit: number): Promise<HolderSeed[]> {
  const url = heliusRpcUrl()
  if (!url) return []
  try {
    const largest = await rpcCall<LargestAccountsResult>(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenLargestAccounts',
      params: [mint],
    })
    const accounts = (largest?.value ?? []).slice(0, limit)
    if (accounts.length === 0) return []

    // Map token account → owning wallet (getAccountInfo parsed SPL layout).
    const owners = await Promise.all(
      accounts.map((a) =>
        rpcCall<ParsedAccountResult>(url, {
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [a.address, { encoding: 'jsonParsed' }],
        }),
      ),
    )
    const seeds: HolderSeed[] = []
    accounts.forEach((a, i) => {
      const info = owners[i]?.value?.data?.parsed?.info
      const owner = info?.owner
      if (!owner) return
      const raw = Number(a.amount ?? '0')
      const decimals = info?.decimals ?? 9
      seeds.push({
        owner,
        amount: Number.isFinite(raw) ? raw / 10 ** decimals : 0,
        decimals,
        // No PnL from an address-only source — must stay 0/null so the
        // fast path records nothing (see fetchTopHolders docs).
        usdValue: 0,
        costCur: 0,
        unrealizedProfit: null,
        realizedProfit: null,
        suspicious: false,
        tags: ['helius-holder'],
      })
    })
    return seeds
  } catch {
    return []
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Trace a token: classify its top holders and build screening evidence.
 * Never throws: RPC/DB failure returns an empty, explicitly-sourced result.
 */
export async function traceTokenBuyers(
  contract: string,
  chain: string,
  opts: { maxHolders?: number; ttlMs?: number } = {},
): Promise<SmartMoneyEvidence> {
  const ttlMs = opts.ttlMs ?? TTL_MS
  const key = `${chain}:${contract}:${opts.maxHolders ?? 12}`
  const hit = traceCache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.evidence

  // Deadline guard: the underlying harvest is unbounded, so the caller gets
  // an empty (explicitly-sourced) result rather than a stalled scan.
  const raced = await Promise.race([
    traceOnce(contract, chain, opts, ttlMs, key).catch(() => null),
    sleep(TRACE_BUDGET_MS).then(() => null),
  ])
  return raced ?? emptyEvidence(contract, chain, ttlMs)
}

/** Explicitly-empty evidence: source names the miss, nothing is invented. */
function emptyEvidence(contract: string, chain: string, ttlMs: number): SmartMoneyEvidence {
  return {
    contract,
    chain,
    buyers: [],
    walletsHolding: 0,
    byStatus: {},
    strongest: null,
    bullishHoldingUsd: null,
    ttlMs,
    source: 'wallet-tracer:onchain',
  }
}

async function traceOnce(
  contract: string,
  chain: string,
  opts: { maxHolders?: number },
  ttlMs: number,
  key: string,
): Promise<SmartMoneyEvidence> {

  const empty: SmartMoneyEvidence = {
    contract,
    chain,
    buyers: [],
    walletsHolding: 0,
    byStatus: {},
    strongest: null,
    bullishHoldingUsd: null,
    ttlMs,
    source: 'wallet-tracer:onchain',
  }
  if (chain !== 'solana') return empty
  try {
    const buyers: WalletBuyer[] = []
    const holders = await fetchTopHolders(contract, Math.min(opts.maxHolders ?? 12, MAX_HOLDERS_PER_TRACE))
    // Fast path: GMGN holder rows already carry measured per-holder PnL
    // (cost_cur / usd_value / realized_profit). A holder with sustained
    // realized profit is recorded, but as TRACER_PNL — one token's worth of
    // PnL is not a track record, and it must never read as a qualified
    // classification. Classifier PROVISIONAL (n=10-14 episodes) stays in
    // the slow path and keeps its own meaning.
    for (const h of holders) {
      const realized = h.realizedProfit ?? 0
      const cost = h.costCur > 0 ? h.costCur : null
      const pnlFrac = cost !== null && cost > 0 ? realized / cost : (h.unrealizedProfit !== null && h.usdValue > 0 ? h.unrealizedProfit / h.usdValue : null)
      if (realized > 0 && pnlFrac !== null && pnlFrac >= 0.2 && !h.suspicious) {
        buyers.push({
          walletId: h.owner,
          address: h.owner,
          alias: null,
          status: TRACER_PNL_STATUS,
          pnl30d: pnlFrac,
          winRate: null,
          sampleCount: 1,
          classifiedAt: new Date(),
          holdingUsd: h.usdValue > 0 ? h.usdValue : null,
          stale: false,
        })
      }
    }
    if (buyers.length > 0) {
      const byStatus: Record<string, number> = {}
      for (const b of buyers) byStatus[b.status as string] = (byStatus[b.status as string] ?? 0) + 1
      const strongest = BULLISH_STATUSES.find((s) => (byStatus[s] ?? 0) > 0) ?? null
      const ev: SmartMoneyEvidence = {
        contract,
        chain,
        buyers,
        walletsHolding: holders.length,
        byStatus,
        strongest,
        bullishHoldingUsd: buyers.map((b) => b.holdingUsd).filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) || null,
        ttlMs,
        source: 'wallet-tracer:gmgn-holders',
      }
      traceCache.set(key, { at: Date.now(), evidence: ev })
      return ev
    }
    // On-chain fallback is OFF by default: measured 2026-10-11 — a single
    // wallet's 10-signature harvest took 212s (public RPC 429s, then
    // -32015), so the 20s budget always expired and every slow-path trace
    // returned 0 buyers after burning the whole budget. GMGN holder rows
    // (400ms-1s, real realized_pnl) are the working source. Re-enable only
    // when a keyed RPC is configured.
    if (process.env.SNIPER_TRACE_ONCHAIN !== 'true') return empty
    // Slow path: on-chain harvest + full classification.
    for (const h of holders) {
      try {
        const { swaps } = await harvestWallet(h.owner, {
          limit: MAX_TX_PER_HOLDER,
          days: 30,
          withUsd: true,
          throttleMs: THROTTLE_MS,
        })
        const built = buildEpisodes(swaps as NormalizedSwap[])
        const trades = toTradeEpisodes(built.episodes)
        const out = classifyWallet({
          episodes: trades,
          whale: { maxSinglePositionUsd: null, portfolioUsd: null, buyVolume30dUsd: null },
          tx7d: null,
          distinctTokensTraded: new Set(trades.map((t) => t.token)).size,
          feeComplete: trades.every((t) => t.feeKnown),
          clusterDataAvailable: false,
        })
        if ((BULLISH_STATUSES as readonly string[]).includes(out.status)) {
          buyers.push({
            walletId: h.owner,
            address: h.owner,
            alias: null,
            status: out.status,
            pnl30d: out.pnl30d,
            winRate: out.winRate,
            sampleCount: out.episodesUsed,
            classifiedAt: new Date(),
            holdingUsd: h.usdValue > 0 ? h.usdValue : null,
            stale: false,
          })
        }
      } catch {
        // one bad holder never kills the trace
      } finally {
        await sleep(THROTTLE_MS)
      }
    }
    const byStatus: Record<string, number> = {}
    for (const b of buyers) byStatus[b.status as string] = (byStatus[b.status as string] ?? 0) + 1
    const strongest = BULLISH_STATUSES.find((s) => (byStatus[s] ?? 0) > 0) ?? null
    const ev: SmartMoneyEvidence = {
      contract,
      chain,
      buyers,
      walletsHolding: holders.length,
      byStatus,
      strongest,
      bullishHoldingUsd: null,
      ttlMs,
      source: 'wallet-tracer:onchain',
    }
    traceCache.set(key, { at: Date.now(), evidence: ev })
    return ev
  } catch {
    return empty
  }
}

/** Persist a traced result into the wallet DB (idempotent upsert). */
export async function persistTracedBuyers(ev: SmartMoneyEvidence): Promise<number> {
  let written = 0
  for (const b of ev.buyers) {
    try {
      const w = await prisma.wallet.upsert({
        where: { address: b.address },
        create: {
          address: b.address,
          chain: ev.chain,
          labels: ['traced-buyer'],
          riskScore: 0,
          lastSeen: new Date(),
          sourceFile: 'wallet-tracer:onchain',
          discoveredAt: new Date(),
        },
        update: { lastSeen: new Date() },
      })
      await prisma.smartMoneyWallet.upsert({
        where: { walletId: w.id },
        create: {
          walletId: w.id,
          category: 'trader',
          score: b.winRate ?? 0,
          status: b.status,
          pnl30d: b.pnl30d,
          winRate: b.winRate,
          sampleCount: b.sampleCount,
          profitableTokens: 0,
          confidence: 'low',
          reasons: { source: ev.source, contract: ev.contract },
          limitations: { traced: true },
          classifiedAt: new Date(),
        },
        update: {
          status: b.status,
          pnl30d: b.pnl30d,
          winRate: b.winRate,
          sampleCount: b.sampleCount,
          classifiedAt: new Date(),
        },
      })
      written++
    } catch {
      continue
    }
  }
  return written
}
