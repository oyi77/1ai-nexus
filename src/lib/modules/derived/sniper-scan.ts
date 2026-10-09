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
import { isSniperCircuitLocked } from '@/lib/modules/derived/sniper-circuit'
import {
  toSniperPayload,
  type SniperEnrichedToken,
} from '@/lib/modules/derived/sniper-source'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'
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

function seenTtlMs(): number {
  return Number(process.env.SNIPER_SEEN_TTL_MS) || 60 * 60_000
}

function seenPath(): string {
  return process.env.SNIPER_SEEN_PATH || join(process.cwd(), 'data', 'sniper-seen.json')
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

interface DexPair {
  chainId?: string
  pairCreatedAt?: number
  marketCap?: number
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
      riskKnown: false,
    }
    out.push(token)
  }
  // Hottest first: young pairs with the most live 5m flow.
  out.sort((a, b) => (b.volume5m ?? 0) - (a.volume5m ?? 0))
  return out.slice(0, limit)
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
  deliver: (text: string) => Promise<boolean>
}

async function discoverCombined(limit: number): Promise<SniperEnrichedToken[]> {
  try {
    const fresh = await discoverGeckoNewPools(limit)
    if (fresh.length > 0) return fresh
  } catch { /* fall through to boosts */ }
  return discoverYoungPairs(limit)
}

const LIVE_DEPS: SniperScanDeps = {
  discover: discoverCombined,
  audit: collectAudits,
  deliver: deliverSniperAlert,
}

export interface SniperScanDecision extends SniperDecision {
  contract: string
  ticker: string
  /** True when evaluated within the seen-TTL — evaluated, not re-sent. */
  deduped: boolean
  delivered: boolean
  auditsUsed: string[]
}

export interface SniperScanResult {
  scanned: number
  executed: number
  watchlisted: number
  rejected: number
  deduped: number
  delivered: number
  decisions: SniperScanDecision[]
  errors: string[]
}

/** One scan pass: discover → audit → evaluate → (optionally) deliver. */
export async function runSniperScan(
  opts: { limit?: number; deliver?: boolean } = {},
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
  const circuitLocked = isSniperCircuitLocked()
  const decisions: SniperScanDecision[] = []
  let delivered = 0

  for (const token of candidates) {
    try {
      const audits = await deps.audit(token.chain, token.contract)
      const payload = toSniperPayload(token, audits)
      const decision = evaluateSniper(payload, { circuitLocked })
      const deduped = seen[token.contract] !== undefined
      let wasDelivered = false
      // Only push actionable legs, and never re-push a seen contract.
      if (!deduped && opts.deliver === true && decision.status !== 'REJECT') {
        wasDelivered = await deps.deliver(decision.alert)
        if (wasDelivered) delivered++
      }
      seen[token.contract] = Date.now()
      decisions.push({
        ...decision,
        contract: token.contract,
        ticker: payload.ticker,
        deduped,
        delivered: wasDelivered,
        auditsUsed: audits.map((a) => a.platform),
      })
    } catch (err) {
      errors.push(`${token.contract.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  markSeenState(seen)

  return {
    scanned: candidates.length,
    executed: decisions.filter((d) => d.status === 'EXECUTE').length,
    watchlisted: decisions.filter((d) => d.status === 'WATCHLIST').length,
    rejected: decisions.filter((d) => d.status === 'REJECT').length,
    deduped: decisions.filter((d) => d.deduped).length,
    delivered,
    decisions,
    errors,
  }
}
