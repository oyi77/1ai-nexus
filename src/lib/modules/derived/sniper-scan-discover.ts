// ─────────────────────────────────────────────────────────────
// Sniper scan — discovery: gecko/dexscreener/call-feed/wallet/confluence.
// Carved verbatim from sniper-scan.ts for the 800-line gate.
// ─────────────────────────────────────────────────────────────

import {
  type SniperEnrichedToken,
} from '@/lib/modules/derived/sniper-source'
import { discoverTrenches, trenchesGateOn } from '@/lib/modules/derived/discover-trenches'
import type { MemePlatform } from '@/lib/modules/meme/types'
import {
  candidateKey,
  categoryFor,
  mergeEvidence,
  type CandidateEvidence,
} from '@/lib/modules/derived/unified-candidate'
import { loadConfluencePrefetch } from '@/lib/modules/derived/db-confluence-prefetch'
import { loadWalletBuys } from '@/lib/modules/derived/db-wallet-buys'
import { loadWhaleBuys } from '@/lib/modules/derived/whale-buy-store'
import { loadCallFeed } from '@/lib/modules/derived/db-call-feed'

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

function sniperPrefilterFloors(): { minMcUsd: number; minLiqUsd: number } {
  const mc = Number(process.env.SNIPER_MIN_MARKET_CAP_USD)
  const liq = Number(process.env.SNIPER_MIN_LIQUIDITY_USD)
  return {
    minMcUsd: Number.isFinite(mc) && mc >= 0 ? mc : 5_000,
    minLiqUsd: Number.isFinite(liq) && liq >= 0 ? liq : 2_000,
  }
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
  const rows = await loadCallFeed()
  return rows.map((r) => ({
    contract: r.contract,
    chain: r.chain,
    source_count: r.sourceCount,
    mentions: r.mentions,
    kinds: r.kinds,
    sources: r.sources,
    first_seen: r.firstSeen,
    last_seen: r.lastSeen,
    ...(typeof r.weightedScore === 'number' && Number.isFinite(r.weightedScore) && {
      weighted_score: r.weightedScore,
    }),
    ...(r.callerWeights !== undefined &&
      typeof r.callerWeights === 'object' &&
      r.callerWeights !== null && { caller_weights: r.callerWeights }),
  }))
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
  const rows = await loadWalletBuys()
  return rows.map((r) => ({
    contract: r.contract,
    chain: r.chain,
    buyers: r.buyers,
    buyVolumeUsd: r.buyVolumeUsd,
    buyCount: r.buyCount,
    firstBuyAt: r.firstBuyAt ?? 0,
    lastBuyAt: r.lastBuyAt ?? 0,
  }))
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

/**
 * Autonomous whale-buy discovery (token-first scanner).
 * Reads the whale-buy-scanner store (source='whale-buy-scanner' in
 * WalletBuySignal) — written by whale-buy-scan-cron. Hydrates each
 * Solana mint from Dexscreener, same base58 guard as wallet buys.
 */
async function discoverWhaleBuys(limit: number): Promise<SniperEnrichedToken[]> {
  let rows: Array<{
    contract: string
    chain: string
    buyers: string[]
    buyVolumeUsd: number
    buyCount: number
    firstBuyAt: number | null
    lastBuyAt: number | null
  }> = []
  try {
    rows = await loadWhaleBuys()
  } catch {
    return [] // store is opportunistic — never throw
  }
  const out: SniperEnrichedToken[] = []
  for (const r of rows) {
    if (out.length >= limit) break
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.contract)) continue
    const live = await hydrateFromDexscreener(r.chain, r.contract)
    if (!live) continue
    out.push({
      ...live,
      discoveryEvidence: [
        {
          provider: 'whale-buy-scanner',
          category: 'WHALE_ACTIVITY',
          discoveredAt: r.lastBuyAt ?? Date.now(),
          note: `whale scan: ${r.buyers.length} buyer(s) | $${Math.round(r.buyVolumeUsd).toLocaleString()} across ${r.buyCount} legs`,
        } as CandidateEvidence,
      ],
    })
  }
  return out
}

/**
 * Smart-money confluence discovery (Fase 4).
 * Reads data/confluence-latest.json (written by confluence-cron from >=2 qualified
 * buyers in a 15-minute sliding window). Hydrates each valid Solana mint from Dexscreener.
 */
export async function discoverConfluenceCandidates(limit: number): Promise<SniperEnrichedToken[]> {
  const rows = await loadConfluencePrefetch()
  const out: SniperEnrichedToken[] = []
  for (const r of rows) {
    if (out.length >= limit) break
    // Same base58 guard as wallet buys: only valid Solana base58 mints
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.contract)) continue
    const live = await hydrateFromDexscreener('solana', r.contract)
    if (!live) continue // unlisted pair → not snipeable, never faked
    out.push({
      ...live,
      id: `confluence:${r.contract}`,
      provenance: {
        sourceType: 'operator-feed',
        provider: 'smart-money-confluence' as unknown as MemePlatform,
        note: `confluence: ${r.buyers.length} qualified buyers`,
      },
      discoveryEvidence: [
        {
          provider: 'smart-money-confluence',
          category: 'WHALE_ACTIVITY',
          discoveredAt: r.lastBuyAt || Date.now(),
          note: `confluence: ${r.buyers.length} qualified buyers (${r.buyers.slice(0, 3).join(', ')}) | $${Math.round(r.totalBuyUsd).toLocaleString()}`,
          buyers: r.buyers,
          confluence: r.buyers.length,
        } as CandidateEvidence,
      ],
    })
  }
  return out
}

type DiscoverMode = 'auto' | 'api' | 'call-feed' | 'wallet' | 'confluence'

function discoverMode(): DiscoverMode {
  const v = (process.env.SNIPER_DISCOVER_MODE || 'auto').toLowerCase()
  return v === 'api' || v === 'call-feed' || v === 'wallet' || v === 'confluence' ? v : 'auto'
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

export async function discoverCombined(limit: number): Promise<SniperEnrichedToken[]> {
  const mode = discoverMode()
  let candidates: SniperEnrichedToken[] = []
  // Wallet buys are the strongest intent signal we own: a classified wallet
  // already put real money in BEFORE any list ranks it. Runs first in wallet
  // mode and as an opportunistic union member in auto mode.
  if (mode === 'confluence') {
    try {
      const conf = await discoverConfluenceCandidates(limit)
      if (conf.length > 0) candidates = conf
    } catch { /* confluence artifact is opportunistic — market lists fallback */ }
  } else if (mode === 'wallet') {
    try {
      const [confRes, buysRes, whaleRes] = await Promise.allSettled([
        discoverConfluenceCandidates(limit),
        discoverWalletBuys(limit),
        discoverWhaleBuys(limit),
      ])
      const conf = confRes.status === 'fulfilled' ? confRes.value : []
      const buys = buysRes.status === 'fulfilled' ? buysRes.value : []
      const wlbuys = whaleRes.status === 'fulfilled' ? whaleRes.value : []
      const unionedBuys = buys.length > 0 && wlbuys.length > 0 ? unionCandidates(buys, wlbuys) : (buys.length > 0 ? buys : wlbuys)
      const whale = conf.length > 0 && unionedBuys.length > 0 ? unionCandidates(conf, unionedBuys) : (conf.length > 0 ? conf : unionedBuys)
      if (whale.length > 0) candidates = whale
    } catch { /* wallet artifact is opportunistic — market lists fallback */ }
  } else if (mode === 'auto') {
    try {
      const [confRes, buysRes, whaleRes] = await Promise.allSettled([
        discoverConfluenceCandidates(limit),
        discoverWalletBuys(limit),
        discoverWhaleBuys(limit),
      ])
      const conf = confRes.status === 'fulfilled' ? confRes.value : []
      const buys = buysRes.status === 'fulfilled' ? buysRes.value : []
      const wlbuys = whaleRes.status === 'fulfilled' ? whaleRes.value : []
      const unionedBuys = buys.length > 0 && wlbuys.length > 0 ? unionCandidates(buys, wlbuys) : (buys.length > 0 ? buys : wlbuys)
      const whale = conf.length > 0 && unionedBuys.length > 0 ? unionCandidates(conf, unionedBuys) : (conf.length > 0 ? conf : unionedBuys)
      if (whale.length > 0) {
        const api = await discoverApiOnly(limit)
        candidates = unionCandidates(whale, api)
      }
    } catch { /* whale/confluence artifacts are opportunistic — market lists fallback */ }
  }
  // Operator call-feed is the fastest attention signal: a token called by
  // 3+ independent channels is worth auditing before the API lists catch up.
  if (candidates.length === 0 && (mode === 'call-feed' || mode === 'auto')) {
    let feed: SniperEnrichedToken[] = []
    try {
      feed = await discoverCallFeed(limit)
    } catch { /* feed is opportunistic — confluence/wallet/API still run */ }
    if (mode === 'call-feed') {
      // call-feed + confluence + wallet: the same whale union as auto mode,
      // merged with the feed so confluence signals from data/confluence-latest.json
      // are never dead in this mode. An overlap merges evidence; a feed-only
      // or confluence-only token still enters the audit pipeline.
      try {
        const [confRes, buysRes, whaleRes] = await Promise.allSettled([
          discoverConfluenceCandidates(limit),
          discoverWalletBuys(limit),
          discoverWhaleBuys(limit),
        ])
        const conf = confRes.status === 'fulfilled' ? confRes.value : []
        const buys = buysRes.status === 'fulfilled' ? buysRes.value : []
        const wlbuys = whaleRes.status === 'fulfilled' ? whaleRes.value : []
        const unionedBuys = buys.length > 0 && wlbuys.length > 0 ? unionCandidates(buys, wlbuys) : (buys.length > 0 ? buys : wlbuys)
        const whale = conf.length > 0 && unionedBuys.length > 0 ? unionCandidates(conf, unionedBuys) : (conf.length > 0 ? conf : unionedBuys)
        const combined = feed.length > 0 && whale.length > 0
          ? unionCandidates(feed, whale)
          : (feed.length > 0 ? feed : whale)
        if (combined.length > 0) candidates = combined
      } catch { /* confluence/wallet are opportunistic — API lists are the fallback */ }
    } else if (feed.length > 0) {
      // auto: union feed + API lists, feed-listed contracts first. An
      // overlap is merged (feed evidence + API market snapshot), not
      // dropped — the API row often carries the live m5 flow the feed lacks.
      try {
        const api = await discoverApiOnly(limit)
        candidates = unionCandidates(feed, api)
      } catch { /* API lists are opportunistic */ }
    }
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
  // Trenches is additive (opt-in, SNIPER_TRENCHES_DISCOVERY + the shared
  // SOLPUMP_TRENCHES_ENABLED fetch flag): bonding-curve sweet-spot rows join
  // the same union — an overlap with an API row merges into ONE candidate
  // carrying the trenches lifecycle evidence plus the live market snapshot,
  // which is exactly the row the momentum gates need.
  const [fresh, boosts, trenches] = await Promise.allSettled([
    discoverGeckoNewPools(limit),
    discoverYoungPairs(limit),
    discoverTrenches(limit),
  ])
  const a = fresh.status === 'fulfilled' ? fresh.value : []
  const b = boosts.status === 'fulfilled' ? boosts.value : []
  const t = trenches.status === 'fulfilled' ? trenches.value : []
  const apiUnion = unionCandidates(a, b)
  console.log(
    `[sniper] trenches discovery: ${t.length} sweet-spot candidates (gate ${trenchesGateOn() ? 'on' : 'off'})`,
  )
  return unionCandidates(apiUnion, t)
}
