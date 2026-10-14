// ─────────────────────────────────────────────────────────────
// Meme Sniper scan — one live pass: discover → audit → evaluate → deliver.
//
// Discovery: dexscreener token boosts (fresh promoted tokens) → batch
// /tokens/v1/{addresses} pairs (volume.m5, pairCreatedAt, marketCap).
// Audit fan-out: rugcheck + birdeye + gmgn per contract, each source
// error-isolated (Promise.allSettled), merged → toSniperPayload →
// evaluateSniper. Seen-state (data/sniper-seen.json) dedupes repeat evals
// of the same contract for SNIPER_SEEN_TTL_MS (default 1h).
//
// `runSniperScan` takes injectable deps so tests never touch the network.
// The default deps are the live ones. Zero DB, zero LLM.
// ─────────────────────────────────────────────────────────────

import {
  evaluateSniper,
  deliverSniperAlert,
  type SniperDecision,
} from '@/lib/modules/derived/meme-sniper'
import {
  toSniperPayload,
  type SniperEnrichedToken,
} from '@/lib/modules/derived/sniper-source'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'
import { traceTokenBuyers } from '@/lib/modules/derived/wallet-tracer'
import {
  getSmartMoneyEvidence,
  evaluateSmartMoneyGate,
  type SmartMoneyEvidence,
} from '@/lib/modules/derived/smart-money-provider'
import {
  classifySignalTier,
  shouldDeliver,
  formatTieredSignal,
  DEFAULT_DELIVERY_POLICY,
  type SignalTier,
  type DeliveryPolicy,
  type ContractButtons,
} from '@/lib/modules/derived/signal-tier'
import {
  candidateKey,
  categoryFor,
  mergeEvidence,
  resolveCategory,
  type CandidateEvidence,
  type DiscoveryCategory,
} from '@/lib/modules/derived/unified-candidate'
import {
  collapseDuplicateCandidatesByTrust,
  normalizeTickerForDedup,
} from '@/lib/modules/derived/candidate-trust'

import { profilesForPhase } from '@/lib/modules/derived/sniper-criteria'
import { toSniperGate, assessDevHistory, type DevHistoryVerdict } from '@/lib/modules/derived/dev-history'
import { fetchDevTokenHistory } from '@/lib/modules/meme/solpump/dev-tokens'
import { auditRugcheckToken } from '@/lib/modules/meme/rugcheck'
import { auditBirdeyeToken } from '@/lib/modules/meme/birdeye'
import { auditGmgnToken } from '@/lib/modules/meme/gmgn'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DEXS = 'https://api.dexscreener.com'
const GECKO = 'https://api.geckoterminal.com'

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

interface GeckoPool {
  id?: string
  attributes?: {
    name?: string
    pool_created_at?: string
    base_token_price_usd?: string
    market_cap_usd?: string | null
    fdv_usd?: string
    reserve_in_usd?: string
    volume_usd?: Record<string, string>
  }
  relationships?: { base_token?: { data?: { id?: string } } }
}

async function geckoGet<T>(path: string): Promise<T> {
  const res = await fetch(`${GECKO}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`geckoterminal ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

/** Minutes after which a candidate's data is too old to signal on. */
const STALE_AFTER_MINUTES = Number(process.env.SNIPER_STALE_AFTER_MINUTES) || 120

function seenTtlMs(): number {
  return Number(process.env.SNIPER_SEEN_TTL_MS) || 60 * 60_000
}

function seenPath(): string {
  return process.env.SNIPER_SEEN_PATH || join(process.cwd(), 'data', 'sniper-seen.json')
}

// Discovery pre-filter floors (spec C / audit finding F2 #1). These are
// env-configurable because no documented criteria threshold exists for a
// discovery-time MC/liquidity floor — they are NOT invented screening rules,
// just a spam gate upstream of the evaluator.
function sniperPrefilterFloors(): { minMcUsd: number; minLiqUsd: number } {
  const mc = Number(process.env.SNIPER_MIN_MARKET_CAP_USD)
  const liq = Number(process.env.SNIPER_MIN_LIQUIDITY_USD)
  return {
    minMcUsd: Number.isFinite(mc) && mc >= 0 ? mc : 5_000,
    minLiqUsd: Number.isFinite(liq) && liq >= 0 ? liq : 2_000,
  }
}

export function readSeenState(): Record<string, number> {
  try {
    const p = seenPath()
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, number>
    const cutoff = Date.now() - seenTtlMs()
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) if (v >= cutoff) out[k] = v
    return out
  } catch {
    return {}
  }
}

export function markSeenState(map: Record<string, number>): void {
  try {
    const p = seenPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(map))
  } catch { /* dedupe state is best-effort */ }
}

// ─────────────────────────────────────────────────────────────
// Ticker-level seen state — suppresses delivery of copycat mints
// that re-launch under the same normalized ticker but a different
// contract within the seen-TTL. Stored alongside contract keys in
// the same sniper-seen.json file under a `ticker:` prefix so there
// is no second file to manage or drift out of sync.
// ─────────────────────────────────────────────────────────────

const TICKER_SEEN_PREFIX = 'ticker:'

/**
 * Read the ticker-level seen map from the same seen-state file.
 * Keys are `ticker:<normalizedTicker>`, values are timestamps.
 * Pure read — does not mutate the file.
 */
export function readTickerSeenState(): Record<string, number> {
  const seen = readSeenState()
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(seen)) {
    if (k.startsWith(TICKER_SEEN_PREFIX)) {
      out[k.slice(TICKER_SEEN_PREFIX.length)] = v
    }
  }
  return out
}

/**
 * Mark a normalized ticker as seen in the shared seen-state map.
 * Mutates `map` in place — caller persists via `markSeenState`.
 */
export function markTickerSeen(map: Record<string, number>, normalizedTicker: string): void {
  if (normalizedTicker.length === 0) return
  map[`${TICKER_SEEN_PREFIX}${normalizedTicker}`] = Date.now()
}

/**
 * Check whether a normalized ticker was seen under a DIFFERENT contract
 * within the TTL. Returns the timestamp if a prior delivery happened
 * under a different contract, or `null` if not suppressed.
 *
 * `currentContract` is the contract being evaluated now; if the ticker
 * was seen but the key matches this exact contract, re-evaluation is
 * allowed (the contract itself is just re-evaluated, not a copycat).
 */
export function tickerSeenUnderDifferentContract(
  seen: Record<string, number>,
  normalizedTicker: string,
  chain: string,
  contract: string,
): number | null {
  if (normalizedTicker.length === 0) return null
  const tickerKey = `${TICKER_SEEN_PREFIX}${normalizedTicker}`
  const ts = seen[tickerKey]
  if (ts === undefined) return null
  // The ticker was delivered before. If THIS exact contract is already
  // in seen state it is a re-evaluation of the same mint (contract-level
  // dedup owns that case) — not a copycat. Only suppress when the ticker
  // belongs to a different, un-seen contract.
  if (seen[candidateKey(chain, contract)] !== undefined) return null
  return ts
}

interface DexPair {
  chainId?: string
  pairCreatedAt?: number
  marketCap?: number
  fdv?: number
  priceUsd?: string
  priceChange?: Record<string, number>
  volume?: Record<string, number>
  baseToken?: { address?: string; symbol?: string; name?: string }
  liquidity?: { usd?: number }
}

async function dexGet<T>(path: string): Promise<T> {
  const res = await fetch(`${DEXS}${path}`, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`dexscreener ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

/** GeckoTerminal new pools (solana, minute-old) → minute-age rows with live m5 flow. */
async function discoverGeckoNewPools(limit: number): Promise<SniperEnrichedToken[]> {
  const data = await geckoGet<{ data?: GeckoPool[] }>('/api/v2/networks/solana/new_pools?page=1')
  const out: SniperEnrichedToken[] = []
  for (const row of data.data ?? []) {
    const a = row.attributes ?? {}
    const baseId = row.relationships?.base_token?.data?.id ?? ''
    // id shape: "solana_<mint>" — the mint is the sniper's contract.
    const mint = baseId.includes('_') ? baseId.split('_').slice(1).join('_') : ''
    if (!mint) continue
    const createdMs = Date.parse(a.pool_created_at ?? '')
    if (!Number.isFinite(createdMs)) continue
    const ageMs = Date.now() - createdMs
    if (ageMs <= 0 || ageMs > 6 * 60 * 60_000) continue // 6h scan horizon
    const vol5m = toNum(a.volume_usd?.m5)
    if (!(vol5m > 0)) continue // no live money → not snipeable
    // market_cap is usually null on minute-old pools — fdv/reserve proxy keeps
    // the evaluator's ratio computable; a missing cap is NOT treated as zero.
    const mc = toNum(a.market_cap_usd ?? a.fdv_usd ?? a.reserve_in_usd)
    if (!(mc > 0)) continue
    const name = (a.name ?? '').split('/')[0].trim()
    // One row per token: pump.fun curve + graduated AMM are two pools of the
    // same mint — keep only the hottest (proven live: JEANPHIL appeared 2x).
    const dupe = out.findIndex((t) => t.contract === mint)
    if (dupe !== -1) {
      if (vol5m <= (out[dupe].volume5m ?? 0)) continue
      out.splice(dupe, 1)
    }
    out.push({
      id: `solana:${mint}`,
      platform: 'geckoterminal',
      chain: 'solana',
      contract: mint,
      symbol: name,
      name,
      price: toNum(a.base_token_price_usd),
      change24h: 0,
      volume24h: toNum(a.volume_usd?.h24),
      marketCap: mc,
      liquidity: toNum(a.reserve_in_usd),
      createdAt: createdMs,
      riskLevel: 0,
      holders: 0,
      top10HolderPercent: 0,
      social: {},
      audited: false,
      volume5m: vol5m,
      provenance: {
        sourceType: 'public-api',
        provider: 'geckoterminal',
        note: 'geckoterminal new_pools (minute-age, volume.m5, fdv fallback)',
      },
      discoveryEvidence: [
        {
          provider: 'geckoterminal',
          category: categoryFor('geckoterminal', { note: 'new_pools' }),
          discoveredAt: Date.now(),
          note: 'GET /api/v2/networks/solana/new_pools?page=1',
        },
      ],
      riskKnown: false,
    })
  }
  // Hottest first: most live 5m flow.
  out.sort((x, y) => (y.volume5m ?? 0) - (x.volume5m ?? 0))
  return out.slice(0, limit)
}

/** Boosted fresh tokens → filtered young pairs with live 5m volume. */
async function discoverYoungPairs(limit: number): Promise<SniperEnrichedToken[]> {
  const boosts = await dexGet<Array<{ chainId?: string; tokenAddress?: string }>>(
    '/token-boosts/latest/v1',
  )
  // /tokens/v1/{chainId}/{addr,addr...} is per-chain — group first,
  // cap 10 addresses per chain (the API's own batch ceiling).
  const byChain = new Map<string, string[]>()
  for (const b of boosts) {
    if (!b.tokenAddress || !b.chainId) continue
    const arr = byChain.get(b.chainId) ?? []
    if (arr.length < 10 && !arr.includes(b.tokenAddress)) arr.push(b.tokenAddress)
    byChain.set(b.chainId, arr)
  }
  if (byChain.size === 0) return []
  const batchResults = await Promise.allSettled(
    [...byChain.entries()].map(([chain, addrs]) => dexGet<DexPair[]>(`/tokens/v1/${chain}/${addrs.join(',')}`)),
  )
  const pairs = batchResults.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))

  // One row per token: keep the pair with the most live 5m flow.
  const best = new Map<string, DexPair>()
  for (const p of pairs) {
    const addr = p.baseToken?.address
    if (!addr || p.pairCreatedAt == null) continue
    const cur = best.get(addr)
    if (!cur || (p.volume?.m5 ?? 0) > (cur.volume?.m5 ?? 0)) best.set(addr, p)
  }

  const out: SniperEnrichedToken[] = []
  for (const p of best.values()) {
    const ageMs = Date.now() - (p.pairCreatedAt as number)
    if (ageMs <= 0 || ageMs > 6 * 60 * 60_000) continue // 6h scan horizon
    const mc = p.marketCap ?? 0
    const vol5m = p.volume?.m5 ?? 0
    if (!(mc > 0) || !(vol5m > 0)) continue // no live money → not snipeable
    const token: SniperEnrichedToken = {
      id: `${p.chainId}:${p.baseToken?.address}`,
      platform: 'dexscreener',
      chain: p.chainId ?? '',
      contract: p.baseToken?.address ?? '',
      symbol: p.baseToken?.symbol ?? '',
      name: p.baseToken?.name ?? '',
      price: 0,
      change24h: 0,
      volume24h: 0,
      marketCap: mc,
      liquidity: p.liquidity?.usd ?? 0,
      createdAt: p.pairCreatedAt as number,
      riskLevel: 0,
      holders: 0,
      top10HolderPercent: 0,
      social: {},
      audited: false,
      volume5m: vol5m,
      provenance: {
        sourceType: 'public-api',
        provider: 'dexscreener',
        note: 'dexscreener boosts + tokens/v1 pairs (volume.m5)',
      },
      discoveryEvidence: [
        {
          provider: 'dexscreener',
          category: 'NEW_PAIRS',
          discoveredAt: Date.now(),
          note: 'GET /token-boosts/latest/v1 → /tokens/v1/{chain}/{addrs}',
        },
      ],
      riskKnown: false,
    }
    out.push(token)
  }
  // Hottest first: young pairs with the most live 5m flow.
  out.sort((a, b) => (b.volume5m ?? 0) - (a.volume5m ?? 0))
  return out.slice(0, limit)
}

/**
 * Operator call-channel harvest (feed_hunter).
 *
 * Reads data/call-feed-latest.json — the JSON artifact produced by
 * scripts/call-feed.py (Telethon harvest of the operator's 12 call
 * channels, scored by cross-channel confluence). Prefetch mode only:
 * a full live read of 12 channels costs minutes, so the freshness proof
 * is asserted on (a) the artifact's generated_at timestamp and (b) a
 * mandatory seed list of minimum token age. Stale artifact + empty
 * young set ⇒ UNKNOWN-grade result, never a fabricated bullish row.
 */
interface CallFeedCandidate {
  contract: string
  chain: string
  source_count: number
  mentions: number
  kinds: string[]
  sources: string[]
  first_seen: string
  last_seen: string
  /** Weighted confluence from scripts/call-feed.py. Optional: older
   * artifacts predate the field — absent stays absent, never a default. */
  weighted_score?: number
  caller_weights?: Record<string, number>
}

interface CallFeedArtifact {
  generated_at: string
  window_min: number
  candidates: CallFeedCandidate[]
}

async function discoverCallFeed(limit: number): Promise<SniperEnrichedToken[]> {
  const rows = await readCallFeedArtifact()
  // The momentum gate keys on the PAIR's age (2x vol/mcap under 2h, 4x after),
  // so ranking by call time picks the wrong tokens: a token first called 3
  // minutes ago can be a 319h-old pair, which the gate can never pass.
  // Hydrate candidates first, then order by the age the gate actually uses.
  // Measured 2026-10-11: the only rows clearing 2x were 2-3 minute-old pairs
  // that call-time ranking never reached.
  const maxPairAgeMin = Number(process.env.CALL_FEED_MAX_PAIR_AGE_MIN) || 180
  const out: SniperEnrichedToken[] = []
  for (const r of rows) {
    if (!/^([1-9A-HJ-NP-Za-km-z]{32,44}pump|0x[0-9a-fA-F]{40})$/.test(r.contract)) continue
    // The feed artifact carries attention only — no price/volume. Hydrate the
    // row from dexscreener so the momentum gates have real numbers instead of
    // rejecting every feed candidate on volume5m=0.
    const live = await hydrateFromDexscreener(r.chain, r.contract)
    if (!live) continue // unlisted/stale pair → not snipeable, never faked
    out.push({
      ...live,
      id: `call-feed:${r.contract}`,
      provenance: {
        sourceType: 'operator-feed',
        provider: 'call-feed',
        note: `call-feed confluence: ${r.source_count} channels (${r.sources.join(',')})`,
      },
      discoveryEvidence: [
        {
          provider: 'call-feed',
          category: categoryFor('call-feed', { kinds: r.kinds }),
          discoveredAt: Date.parse(r.last_seen) || Date.now(),
          note: `${r.source_count} channels: ${r.sources.join(',')}`,
          mentions: r.mentions,
          confluence: r.source_count,
          ...(typeof r.weighted_score === 'number' && Number.isFinite(r.weighted_score) && {
            weightedScore: r.weighted_score,
          }),
          ...(r.caller_weights !== undefined &&
            typeof r.caller_weights === 'object' &&
            r.caller_weights !== null && { callerWeights: r.caller_weights }),
          kinds: r.kinds,
        },
      ],
    })
  }
  // Newest pair first (the momentum gate's axis), then most 5m flow; the
  // call-feed weighted confluence is only a TIE-BREAKER — it reorders
  // equally-fresh, equally-moving candidates, it never promotes a token
  // past a fresher or better-moving one, and absent weights (0) rank last.
  out.sort(
    (a, b) =>
      (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
      (b.volume5m ?? 0) - (a.volume5m ?? 0) ||
      (b.discoveryEvidence?.[0]?.weightedScore ?? 0) -
        (a.discoveryEvidence?.[0]?.weightedScore ?? 0),
  )
  const nowMs = Date.now()
  return out
    .filter((t) => {
      const ageMin = (nowMs - (t.createdAt ?? 0)) / 60_000
      return !Number.isFinite(ageMin) || ageMin <= maxPairAgeMin
    })
    .slice(0, limit)
}

/**
 * Live market row for one contract, or null when no pair is listed.
 * Picks the deepest pair (most 5m flow) so thin fake pools never win.
 */
async function hydrateFromDexscreener(chain: string, contract: string): Promise<SniperEnrichedToken | null> {
  try {
    const raw = await dexGet<{ pairs?: DexPair[] }>(`/latest/dex/tokens/${contract}`)
    const pairs = (raw.pairs ?? []).filter((p) => (p.chainId ?? '') === chain || !chain)
    if (pairs.length === 0) return null
    const best = pairs.reduce((a, b) => ((b.volume?.m5 ?? 0) > (a.volume?.m5 ?? 0) ? b : a))
    return {
      id: `dexscreener:${best.chainId ?? chain}:${contract}`,
      platform: 'dexscreener',
      chain: best.chainId ?? chain,
      contract,
      symbol: best.baseToken?.symbol ?? '',
      name: best.baseToken?.name ?? '',
      price: Number(best.priceUsd) || 0,
      change24h: best.priceChange?.h24 ?? 0,
      volume24h: best.volume?.h24 ?? 0,
      marketCap: best.marketCap ?? best.fdv ?? 0,
      liquidity: best.liquidity?.usd ?? 0,
      createdAt: best.pairCreatedAt ?? Date.now(),
      riskLevel: 0,
      holders: 0,
      top10HolderPercent: 0,
      social: {},
      audited: false,
      volume5m: best.volume?.m5 ?? 0,
      riskKnown: false,
    }
  } catch {
    return null // network failure != a fabricated row
  }
}

async function readCallFeedArtifact(): Promise<CallFeedCandidate[]> {
  try {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const p = process.env.CALL_FEED_PATH || join(process.cwd(), 'data', 'call-feed-latest.json')
    const raw = JSON.parse(await readFile(p, 'utf8')) as CallFeedArtifact
    const ageMin = (Date.now() - Date.parse(raw.generated_at)) / 60_000
    const maxAge = Number(process.env.CALL_FEED_MAX_AGE_MIN) || 180
    if (!Number.isFinite(ageMin) || ageMin > maxAge) return [] // stale feed ≠ candidates
    return (raw.candidates ?? []).filter((c) => c.source_count >= 1)
  } catch {
    return [] // artifact missing/unparseable → no feed candidates
  }
}


// ─── Wallet-buy discovery (Phase 4) ─────────────────────────────
// A tracked wallet's fresh BUY becomes a candidate before any market list
// ranks it. The wallet-refresh cron already pays the RPC harvest cost and
// writes fresh buys here — the scan never re-harvests on-chain.

interface WalletBuyFile {
  generated_at: string
  min_usd: number
  candidates: Array<{
    contract: string
    chain: string
    buyers: string[]
    buyVolumeUsd: number
    buyCount: number
    firstBuyAt: number
    lastBuyAt: number
  }>
}

async function readWalletBuyArtifact(): Promise<WalletBuyFile['candidates']> {
  try {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const p = process.env.WALLET_BUYS_PATH || join(process.cwd(), 'data', 'wallet-buys-latest.json')
    const raw = JSON.parse(await readFile(p, 'utf8')) as WalletBuyFile
    const ageMin = (Date.now() - Date.parse(raw.generated_at)) / 60_000
    const maxAge = Number(process.env.WALLET_BUYS_MAX_AGE_MIN) || 120
    if (!Number.isFinite(ageMin) || ageMin > maxAge) return [] // stale ≠ candidates
    return raw.candidates ?? []
  } catch {
    return [] // artifact missing/unparseable → no wallet candidates
  }
}

async function discoverWalletBuys(limit: number): Promise<SniperEnrichedToken[]> {
  const rows = await readWalletBuyArtifact()
  const out: SniperEnrichedToken[] = []
  for (const r of rows) {
    if (out.length >= limit) break
    // Same base58 guard as the call feed: an EVM-style row cannot be served
    // by the Solana RPC and would audit as UNKNOWN for every metric.
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.contract)) continue
    const live = await hydrateFromDexscreener(r.chain, r.contract)
    if (!live) continue // unlisted pair → not snipeable, never faked
    out.push({
      ...live,
      discoveryEvidence: [
        {
          provider: 'wallet-trace',
          category: 'WHALE_ACTIVITY',
          discoveredAt: r.lastBuyAt,
          note: `buyers: ${r.buyers.slice(0, 3).join(', ')} | $${Math.round(r.buyVolumeUsd).toLocaleString()} across ${r.buyCount} legs`,
        },
      ],
    })
  }
  return out
}


/** Per-contract audit fan-out — every source isolated. */
async function collectAudits(chain: string, contract: string): Promise<MemeRiskAudit[]> {
  const results = await Promise.allSettled([
    auditRugcheckToken(chain, contract),
    auditBirdeyeToken(chain, contract),
    auditGmgnToken(chain, contract),
  ])
  return results
    .filter((r): r is PromiseFulfilledResult<MemeRiskAudit | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((a): a is MemeRiskAudit => a !== null)
}

export interface SniperScanDeps {
  discover: (limit: number) => Promise<SniperEnrichedToken[]>
  audit: (chain: string, contract: string) => Promise<MemeRiskAudit[]>
  deliver: (text: string, replyMarkup?: ContractButtons) => Promise<boolean>
  /**
   * Wallet-DB smart-money evidence. Injectable so tests stay offline;
   * when omitted the scan runs without wallet confirmation (verdicts cap
   * at WATCHLIST via the evaluator's absent-evidence rule).
   */
  smartMoney?: (chain: string, contract: string) => Promise<SmartMoneyEvidence>
  /**
   * Developer deploy-history classifier (anti-rug). Injectable so tests
   * stay offline; the default assesses via the solpump dev-tokens
   * endpoint. Consulted only when SNIPER_DEV_HISTORY_GATE=true.
   */
  devHistory?: (chain: string, contract: string) => Promise<DevHistoryVerdict>
}

type DiscoverMode = 'auto' | 'api' | 'call-feed' | 'wallet'

function discoverMode(): DiscoverMode {
  const v = (process.env.SNIPER_DISCOVER_MODE || 'auto').toLowerCase()
  return v === 'api' || v === 'call-feed' || v === 'wallet' ? v : 'auto'
}

// ─── Dev-history gate (anti-rug, opt-in) ────────────────────────
// SNIPER_DEV_HISTORY_GATE="true" turns the gate on; default OFF keeps the
// existing pipeline byte-for-byte. The lookup (solpump dev-tokens endpoint)
// is expensive per candidate, so verdicts are memoized per dev for 30 min
// (max 500 entries, oldest evicted) — one dev minting 5 tokens in a scan
// window costs ONE fetch, not five.

const DEV_HISTORY_TTL_MS = 30 * 60_000
const DEV_HISTORY_MAX_ENTRIES = 500
const devHistoryMemo = new Map<string, { verdict: DevHistoryVerdict; at: number }>()

/** Test hook: clear the in-memory dev-history memo cache. */
export function __resetDevHistoryMemoForTests(): void {
  devHistoryMemo.clear()
}

function devHistoryGateEnabled(): boolean {
  return process.env.SNIPER_DEV_HISTORY_GATE === 'true'
}

/**
 * Memoized verdict for the candidate's contract. Failure payloads
 * ({ devAddress: null, tokens: [] }) are cached too — an endpoint outage
 * must not multiply into one fetch per candidate per pass.
 */
async function memoizedDevHistory(
  chain: string,
  contract: string,
  fetcher: (chain: string, contract: string) => Promise<DevHistoryVerdict>,
): Promise<DevHistoryVerdict> {
  const key = `${chain}:${contract}`
  const hit = devHistoryMemo.get(key)
  if (hit && Date.now() - hit.at < DEV_HISTORY_TTL_MS) return hit.verdict
  const verdict = await fetcher(chain, contract)
  if (devHistoryMemo.size >= DEV_HISTORY_MAX_ENTRIES) {
    // Map preserves insertion order — the first key is the oldest entry.
    const oldest = devHistoryMemo.keys().next().value
    if (oldest !== undefined) devHistoryMemo.delete(oldest)
  }
  devHistoryMemo.set(key, { verdict, at: Date.now() })
  return verdict
}

/** Live dep: classify via the solpump dev-tokens adapter (pure judge). */
async function liveDevHistory(chain: string, contract: string): Promise<DevHistoryVerdict> {
  const input = await fetchDevTokenHistory(chain, contract)
  return assessDevHistory(input)
}

/**
 * Union two discovery lists by chain-aware identity. A token seen by both
 * is ONE row with merged evidence — never a duplicate candidate, and never
 * silently dropped. Chain-aware key: a Solana mint differing only in case
 * is a DIFFERENT token (base58 is case-sensitive), so the old blanket
 * toLowerCase() merge is gone.
 */
function unionCandidates(
  primary: SniperEnrichedToken[],
  secondary: SniperEnrichedToken[],
): SniperEnrichedToken[] {
  const byKey = new Map<string, SniperEnrichedToken>()
  for (const t of primary) byKey.set(candidateKey(t.chain, t.contract), t)
  for (const t of secondary) {
    const k = candidateKey(t.chain, t.contract)
    const hit = byKey.get(k)
    if (!hit) {
      byKey.set(k, t)
      continue
    }
    const merged: SniperEnrichedToken = { ...t, ...hit }
    // Fill a numeric gap from the secondary row; never zero a real value.
    for (const f of ['marketCap', 'volume24h', 'liquidity', 'price'] as const) {
      const hv = hit[f] as number | undefined
      const tv = t[f] as number | undefined
      if ((hv === undefined || hv === null || hv === 0) && typeof tv === 'number' && tv > 0) {
        Object.assign(merged, { [f]: tv })
      }
    }
    if ((hit.volume5m ?? 0) <= 0 && (t.volume5m ?? 0) > 0) merged.volume5m = t.volume5m
    merged.discoveryEvidence = mergeEvidence(hit.discoveryEvidence, t.discoveryEvidence)
    byKey.set(k, merged)
  }
  return [...byKey.values()]
}

export interface PrefilterResult {
  kept: SniperEnrichedToken[]
  skipped: number
  unknownMc: number
  unknownLiq: number
}

/**
 * Pure discovery pre-filter. Removes only PROVEN junk: a known market cap
 * below the floor or a known liquidity below the floor. UNKNOWN (null/zero)
 * values are counted separately and passed through — the evaluator already
 * treats them as unproven; this gate must not silently drop them.
 */
export function prefilterCandidates(
  candidates: readonly SniperEnrichedToken[],
  floors: { minMcUsd: number; minLiqUsd: number },
): PrefilterResult {
  const kept: SniperEnrichedToken[] = []
  let skipped = 0
  let unknownMc = 0
  let unknownLiq = 0
  for (const t of candidates) {
    const mc = typeof t.marketCap === 'number' && Number.isFinite(t.marketCap) && t.marketCap > 0 ? t.marketCap : null
    const liq = typeof t.liquidity === 'number' && Number.isFinite(t.liquidity) && t.liquidity > 0 ? t.liquidity : null
    if (mc === null) unknownMc++
    if (liq === null) unknownLiq++
    if (mc !== null && mc < floors.minMcUsd) { skipped++; continue }
    if (liq !== null && liq < floors.minLiqUsd) { skipped++; continue }
    kept.push(t)
  }
  return { kept, skipped, unknownMc, unknownLiq }
}

async function discoverCombined(limit: number): Promise<SniperEnrichedToken[]> {
  const mode = discoverMode()
  let candidates: SniperEnrichedToken[] = []
  // Wallet buys are the strongest intent signal we own: a classified wallet
  // already put real money in BEFORE any list ranks it. Runs first in wallet
  // mode and as an opportunistic union member in auto mode.
  if (mode === 'wallet' || mode === 'auto') {
    try {
      const buys = await discoverWalletBuys(limit)
      if (buys.length > 0 && mode === 'wallet') {
        candidates = buys
      } else if (buys.length > 0) {
        const api = await discoverApiOnly(limit)
        candidates = unionCandidates(buys, api)
      }
    } catch { /* wallet artifact is opportunistic — market lists fallback */ }
  }
  // Operator call-feed is the fastest attention signal: a token called by
  // 3+ independent channels is worth auditing before the API lists catch up.
  if (candidates.length === 0 && (mode === 'call-feed' || mode === 'auto')) {
    try {
      const feed = await discoverCallFeed(limit)
      if (feed.length > 0) {
        if (mode === 'call-feed') {
          candidates = feed
        } else {
          // auto: union feed + API lists, feed-listed contracts first. An
          // overlap is merged (feed evidence + API market snapshot), not
          // dropped — the API row often carries the live m5 flow the feed lacks.
          const api = await discoverApiOnly(limit)
          candidates = unionCandidates(feed, api)
        }
      }
    } catch { /* feed is opportunistic — API lists are the fallback */ }
  }
  if (candidates.length === 0) candidates = await discoverApiOnly(limit)

  // Upstream spam gate: drop only PROVEN junk before audit/evaluation. A
  // known MC/liquidity below the floor never reaches the evaluator, audit
  // trail, or delivery log; null stays because UNKNOWN is the evaluator's
  // job to score as unproven, not ours to delete.
  const floors = sniperPrefilterFloors()
  const pre = prefilterCandidates(candidates, floors)
  console.log(
    `[sniper] pre-filter: skipped=${pre.skipped} unknown-mc=${pre.unknownMc} unknown-liq=${pre.unknownLiq} kept=${pre.kept.length}`,
  )
  return pre.kept.slice(0, limit)
}

async function discoverApiOnly(limit: number): Promise<SniperEnrichedToken[]> {
  // Both keyless API surfaces run every pass: new_pools catches minute-old
  // launches, boosts catches promotion-driven flow. Each is error-isolated
  // (one dead endpoint must not blank the scan) and the union is merged by
  // chain-aware identity so an overlap is one candidate with two evidence rows.
  const [fresh, boosts] = await Promise.allSettled([
    discoverGeckoNewPools(limit),
    discoverYoungPairs(limit),
  ])
  const a = fresh.status === 'fulfilled' ? fresh.value : []
  const b = boosts.status === 'fulfilled' ? boosts.value : []
  return unionCandidates(a, b)
}

/** No-wallet-evidence shape: empty, never a fabricated bullish row. */
function EMPTY_SMART_MONEY(chain: string, contract: string): SmartMoneyEvidence {
  return {
    contract,
    chain,
    buyers: [],
    walletsHolding: 0,
    byStatus: {},
    strongest: null,
    bullishHoldingUsd: null,
    ttlMs: 0,
    source: 'none',
  }
}

/**
 * Wallet evidence for a candidate.
 *
 * The DB path (getSmartMoneyEvidence) only knows tokens already ingested —
 * for a freshly-created mint that is almost always nothing, which caps
 * every candidate at WATCHLIST. When the DB returns no evidence we trace
 * the token's on-chain top holders instead (wallet-tracer), which is what
 * turns "no wallets known" into real classification evidence.
 *
 * `SNIPER_TRACE_WALLETS=false` disables the on-chain trace (DB only).
 */
async function liveSmartMoney(chain: string, contract: string): Promise<SmartMoneyEvidence> {
  const fromDb = await getSmartMoneyEvidence(contract, chain)
  if (fromDb.buyers.length > 0) return fromDb
  if ((process.env.SNIPER_TRACE_WALLETS ?? 'true') === 'false') return fromDb
  try {
    return await traceTokenBuyers(contract, chain)
  } catch {
    return fromDb
  }
}

const LIVE_DEPS: SniperScanDeps = {
  discover: discoverCombined,
  audit: collectAudits,
  deliver: (text: string, replyMarkup?: ContractButtons) => deliverSniperAlert(text, undefined, replyMarkup),
  smartMoney: liveSmartMoney,
  devHistory: liveDevHistory,
}

export interface SniperScanDecision extends SniperDecision {
  contract: string
  ticker: string
  /** True when evaluated within the seen-TTL — evaluated, not re-sent. */
  deduped: boolean
  delivered: boolean
  auditsUsed: string[]
  /** Operator quality tier (policy D). Only HIGH_CONVICTION is a top signal. */
  tier: SignalTier
  tierReasons: string[]
  tierMissing: string[]
  /** Classified wallet buyers backing this token (evidence, with provenance). */
  smartMoneyBuyers: number
  smartMoneyStrongest: string | null
  smartMoneySource: string
  /** How this candidate entered the funnel (MULTI_SOURCE when >1 provider). */
  discoveryCategory: DiscoveryCategory
  /** Every source that reported this token, newest first. */
  discoveryEvidence: CandidateEvidence[]
  /**
   * Market snapshot at evaluation time. Null when the discovery row never
   * proved the number — REVIEW shows UNKNOWN, never a fabricated 0.
   */
  market: {
    marketCapUsd: number | null
    liquidityUsd: number | null
    volume5mUsd: number | null
    priceUsd: number | null
  }
  /**
   * Holder distribution at evaluation time. Feeds the accumulation phase
   * (holder-tier delta across scans) via the audit trail. null = unproven.
   * Optional because older evaluations persisted before this field existed.
   */
  distribution?: {
    devPercent: number | null
    sniperPercent: number | null
    bundlerPercent: number | null
    insiderPercent: number | null
    top10Percent: number | null
    clusterPercent: number | null
  }
}

export interface SniperScanResult {
  scanned: number
  screened: number
  watchlisted: number
  rejected: number
  deduped: number
  delivered: number
  decisions: SniperScanDecision[]
  errors: string[]
  /** Candidates per discovery category — proves coverage per pass. */
  categories: Record<string, number>
}

/** One scan pass: discover → audit → evaluate → (optionally) deliver. */
export async function runSniperScan(
  opts: { limit?: number; deliver?: boolean; deliveryPolicy?: DeliveryPolicy } = {},
  deps: SniperScanDeps = LIVE_DEPS,
): Promise<SniperScanResult> {
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 10)
  const errors: string[] = []
  let candidates: SniperEnrichedToken[] = []
  try {
    candidates = await deps.discover(limit)
  } catch (err) {
    errors.push(`discovery: ${err instanceof Error ? err.message : String(err)}`)
  }

  const seen = readSeenState()

  // Trust-ranking dedup: when multiple mints share the same normalized
  // ticker (copycats / re-launches), keep only the single most-trusted
  // one and drop the rest BEFORE audit/evaluation so the pipeline never
  // wastes an audit pass or a delivery slot on a less-trusted duplicate.
  // Dropped copycats are marked seen so they don't re-enter next pass.
  const collapse = collapseDuplicateCandidatesByTrust(candidates)
  candidates = collapse.kept
  if (collapse.dropped.length > 0) {
    const dupTickers = new Set(
      collapse.dropped.map((d) => normalizeTickerForDedup(d.candidate.symbol)),
    )
    console.log(
      `[sniper] ticker dedup: dropped ${collapse.dropped.length} copycat mints across ${dupTickers.size} duplicate tickers`,
    )
    for (const d of collapse.dropped) {
      seen[candidateKey(d.candidate.chain, d.candidate.contract)] = Date.now()
    }
  }

  const decisions: SniperScanDecision[] = []
  let delivered = 0

  for (const token of candidates) {
    try {
      // Anti-rug pre-gate (opt-in): a dev with a proven serial-rugger/
      // suspect deploy history is rejected BEFORE the audit fan-out, so
      // three upstream API calls are never spent on a doomed candidate.
      // UNPROVEN passes — a brand-new dev is unjudged, not guilty; the
      // security/momentum gates still judge the token itself.
      let devHistoryRejection: string | null = null
      if (devHistoryGateEnabled() && deps.devHistory) {
        const verdict = await memoizedDevHistory(token.chain, token.contract, deps.devHistory)
        const gate = toSniperGate(verdict)
        if (!gate.ok) {
          devHistoryRejection = `[dev-history] ${gate.rejection}: ${verdict.reasons[0]}`
        }
      }
      if (devHistoryRejection) {
        decisions.push({
          status: 'REJECT',
          rationale: devHistoryRejection,
          rejections: [devHistoryRejection],
          warnings: [],
          metrics: {} as SniperDecision['metrics'],
          alert: '',
          contract: token.contract,
          ticker: token.symbol,
          deduped: false,
          delivered: false,
          auditsUsed: [],
          tier: 'REJECT',
          tierReasons: ['dev-history gate'],
          tierMissing: [],
          smartMoneyBuyers: 0,
          smartMoneyStrongest: null,
          smartMoneySource: 'none',
          discoveryCategory: resolveCategory(token.discoveryEvidence),
          discoveryEvidence: token.discoveryEvidence ?? [],
          market: {
            marketCapUsd: token.marketCap > 0 ? token.marketCap : null,
            liquidityUsd: token.liquidity > 0 ? token.liquidity : null,
            volume5mUsd: token.volume5m && token.volume5m > 0 ? token.volume5m : null,
            priceUsd: token.price > 0 ? token.price : null,
          },
        })
        console.log(`[sniper] dev-history reject: ${token.contract.slice(0, 8)} — ${devHistoryRejection}`)
        continue
      }
      const audits = await deps.audit(token.chain, token.contract)
      const { payload, warnings: identityWarnings, auditsAccepted } = toSniperPayload(token, audits)
      // Wallet-DB confirmation is evidence, never a substitute for security.
      const walletEvidence = deps.smartMoney
        ? await deps.smartMoney(token.chain, token.contract)
        : EMPTY_SMART_MONEY(token.chain, token.contract)
      const smartMoney = evaluateSmartMoneyGate(walletEvidence)
      // Operator ebook profiles, chosen by phase so every one of the five
      // actually runs in production (ebooks gate DIFFERENT phases: new-pair
      // vs post-bonding vs exposure window). One evaluator pass judges the
      // token against the whole applicable set: a hard reject from any
      // profile appends evidence, none can un-reject an inline breach, and
      // no profile is consulted twice.
      const decision = evaluateSniper(payload, {
        extraWarnings: identityWarnings,
        smartMoney,
        criteriaProfiles: profilesForPhase(payload.ageMinutes),
      })
      // Operator quality tier (policy D): the evaluator says "safe+moving",
      // the tier says "good enough to send as a TOP signal".
      const tierResult = classifySignalTier({
        decision,
        smartMoney: deps.smartMoney ? walletEvidence : null,
        ageMinutes: payload.ageMinutes,
        staleAfterMinutes: STALE_AFTER_MINUTES,
        dataComplete: true,
      })

      const key = candidateKey(token.chain, token.contract)
      const contractSeen = seen[key] !== undefined
      const normTicker = normalizeTickerForDedup(payload.ticker)
      const priorTickerSeen = tickerSeenUnderDifferentContract(
        seen,
        normTicker,
        token.chain,
        token.contract,
      )
      const deduped = contractSeen || priorTickerSeen !== null
      let wasDelivered = false
      // Only push deliverable tiers, and never re-push a seen contract or a
      // copycat sharing a ticker already delivered under another contract.
      const policy = opts.deliveryPolicy ?? DEFAULT_DELIVERY_POLICY
      if (!deduped && opts.deliver === true && shouldDeliver(tierResult.tier, policy)) {
        // Policy E: delivered signals use the full evidence format, not the
        // evaluator's short alert. Same facts, complete provenance.
        const formatted = formatTieredSignal({
          payload,
          tier: tierResult.tier,
          tierReasons: tierResult.reasons,
          tierMissing: tierResult.missing,
          smartMoney: deps.smartMoney ? walletEvidence : null,
          // Provenance: which independent audits actually agreed, so the
          // operator can weigh cross-confirmation instead of inferring it.
          auditSources: auditsAccepted.map((a) => a.platform),
          marketCapUsd: payload.momentum.marketCap,
        })
        wasDelivered = await deps.deliver(formatted.text, formatted.replyMarkup)
        if (wasDelivered) {
          delivered++
          markTickerSeen(seen, normTicker)
        }
      }
      // Only a non-REJECT outcome is worth remembering. Marking a REJECT seen
      // pinned the contract for the whole seen-TTL, so a token that failed the
      // momentum gate at minute 3 was never re-evaluated when vol/mcap climbed
      // past the threshold (measured 2026-10-11: rejected calls later ran
      // +274%/+683%/+1383%). REJECT rows stay eligible; they are cheap to
      // re-audit and cached.
      if (decision.status !== 'REJECT') seen[key] = Date.now()
      decisions.push({
        ...decision,
        contract: token.contract,
        ticker: payload.ticker,
        deduped,
        delivered: wasDelivered,
        auditsUsed: auditsAccepted.map((a) => a.platform),
        tier: tierResult.tier,
        tierReasons: tierResult.reasons,
        tierMissing: tierResult.missing,
        smartMoneyBuyers: walletEvidence.buyers.length,
        smartMoneyStrongest: walletEvidence.strongest,
        smartMoneySource: walletEvidence.source,
        discoveryCategory: resolveCategory(token.discoveryEvidence),
        discoveryEvidence: token.discoveryEvidence ?? [],
        market: {
          marketCapUsd: token.marketCap > 0 ? token.marketCap : null,
          liquidityUsd: token.liquidity > 0 ? token.liquidity : null,
          volume5mUsd: token.volume5m && token.volume5m > 0 ? token.volume5m : null,
          priceUsd: token.price > 0 ? token.price : null,
        },
        /**
         * Holder distribution as read by THIS evaluation. Persisted so the
         * audit trail can compute a real holder-tier delta across scans
         * (TAHAP 2) instead of re-reading the chain. null = the audit source
         * did not prove the number — never a zero.
         */
        distribution: {
          devPercent: payload.distribution.devPercent,
          sniperPercent: payload.distribution.sniperPercent,
          bundlerPercent: payload.distribution.bundlerPercent,
          insiderPercent: payload.distribution.insiderPercent,
          top10Percent: payload.distribution.top10Percent,
          clusterPercent: payload.distribution.clusterPercent ?? null,
        },
      })
    } catch (err) {
      errors.push(`${token.contract.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  markSeenState(seen)

  return {
    scanned: candidates.length,
    screened: decisions.filter((d) => d.status === 'SIGNAL').length,
    watchlisted: decisions.filter((d) => d.status === 'WATCHLIST').length,
    rejected: decisions.filter((d) => d.status === 'REJECT').length,
    deduped: decisions.filter((d) => d.deduped).length,
    delivered,
    decisions,
    errors,
    categories: decisions.reduce<Record<string, number>>((acc, d) => {
      acc[d.discoveryCategory] = (acc[d.discoveryCategory] ?? 0) + 1
      return acc
    }, {}),
  }
}
