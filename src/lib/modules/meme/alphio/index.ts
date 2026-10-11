// ─────────────────────────────────────────────────────────────
// Module: Alphio (api.alphio.ai) — authed meme intelligence
// sourceType: reverse-engineered
// upstreamProduct: Alphio member API (Bearer, app.alphio.ai session)
//
// WHY a second module next to the keyless `alph` one: api.alphio.ai
// exposes the *rich* pre-computed row set (dev/sniper/bundler/insider
// splits, score breakdown, 4h flows, protocol, safety_shield) that the
// keyless b.alph.ai gateway does not. Everything above the `/v1/crypto/meme/*`
// family is also member-gated, so this module self-gates on a session.
//
// endpoints (all GET, 200 + ret:0 with Authorization — probe 2026-10-09):
//   GET /v1/crypto/meme/trending?sort={volume|holders|graduated}&limit={1..100}
//   GET /v1/crypto/meme/new-tokens?sort={newest|heat}&limit={1..100}[&before=]
//   GET /v1/crypto/meme/search?chain=solana&keyword={q}&limit=10
//   GET /v1/crypto/meme/token?mint={addr}
//   GET /v1/crypto/meme/kline?mint={addr}&interval={1m..}&limit={1..1000}
//   GET /v1/crypto/meme/holders?mint={addr}
//   GET /v1/crypto/meme/token-trades?mint={addr}&limit={n}[&cursor=]  (upstream 504s under load)
// headers: Origin=https://app.alphio.ai, Referer=https://app.alphio.ai/,
//          X-App-Id=alphio, X-Mobile-Type=platform=web;version=v1.0.0, lang=en
//   - `lang` is REQUIRED: the ApiClient skips it only for */ws/auth paths.
//   - auth: Authorization: Bearer <access token>; without it the member
//     family answers ret:10023 ("user not login"). No server-side refresh
//     exists (see ./session.ts) — the 45-day AT is the durable credential.
// canonical label → upstream chain id is identity here (api emits full ids).
// lastVerified: 2026-10-09
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemeRiskAudit } from '../types'
import { normalizeChainId, normalizeTimestamp } from '../normalize'
import { resolveAlphioAccessToken } from './session'
import { logger } from '@/lib/logger'

// ── Constants ────────────────────────────────────────────────

const BASE = 'https://api.alphio.ai'
const CONTEXT = 'meme:alphio'
const ALPHIO_TIMEOUT_MS = 12_000
const MAX_RETRIES = 3
const BASE_RETRY_MS = 800

/** Upstream chain labels this module can serve (mirrors MemePlatform chains). */
const ALPHIO_CHAINS = new Set(['solana', 'ethereum', 'binance-smart-chain', 'base'])

// ── Raw Payload Shapes ───────────────────────────────────────

/** Row shape shared by /trending, /new-tokens and /search list envelopes. */
interface AlphioMemeRow {
  chain?: unknown
  mint?: unknown
  name?: unknown
  symbol?: unknown
  creator?: unknown
  created_at?: unknown
  migrated_at?: unknown
  status?: unknown
  price_usd?: unknown
  market_cap_usd?: unknown
  liquidity_usd?: unknown
  bonding_progress?: unknown
  holders?: unknown
  volume_5m_usd?: unknown
  volume_1h_usd?: unknown
  volume_4h_usd?: unknown
  volume_24h_usd?: unknown
  price_change_5m?: unknown
  price_change_1h?: unknown
  price_change_4h?: unknown
  price_change_24h?: unknown
  total_supply?: unknown
  dev_holding_pct?: unknown
  dev_sold_pct?: unknown
  top10_holding_pct?: unknown
  insider_pct?: unknown
  sniper_pct?: unknown
  bundler_pct?: unknown
  bot_pct?: unknown
  kol_pct?: unknown
  whale_pct?: unknown
  smart_money_pct?: unknown
  protocol?: unknown
  logo?: unknown
  twitter?: unknown
  telegram?: unknown
  website?: unknown
  score_level?: unknown
  narrative_score?: unknown
  activity_score?: unknown
  heat_score?: unknown
  momentum_score?: unknown
  safety_shield?: unknown
  safety_flags?: unknown
}

interface AlphioListEnvelope {
  ret?: unknown
  msg?: unknown
  list?: unknown
  next_cursor?: unknown
  updated_at?: unknown
}

interface AlphioTokenEnvelope {
  ret?: unknown
  msg?: unknown
  data?: unknown
}

interface AlphioHolderRow {
  address?: unknown
  balance?: unknown
  pct_of_supply?: unknown
  buy_amount_usd?: unknown
  sell_amount_usd?: unknown
  avg_buy_price_usd?: unknown
  realized_pnl_usd?: unknown
  buys?: unknown
  sells?: unknown
  handle?: unknown
  display_name?: unknown
  tags?: unknown
  first_active_ms?: unknown
  last_active_ms?: unknown
}

interface AlphioHoldersEnvelope {
  ret?: unknown
  data?: { list?: unknown; total_holders?: unknown } | null
}

// ── Helpers ──────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function trimmed(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

/** Upstream `ret: 0` means OK; anything else is a soft error envelope. */
function retOk(v: unknown): boolean {
  return num(v, -1) === 0
}

function authHeaders(): Record<string, string> {
  return {
    Origin: 'https://app.alphio.ai',
    Referer: 'https://app.alphio.ai/',
    'X-App-Id': 'alphio',
    'X-Mobile-Type': 'platform=web;version=v1.0.0',
    lang: 'en',
    Accept: 'application/json',
  }
}

async function fetchJson<T>(
  url: string,
  token: string,
  attempt = 1,
  timeoutMs = ALPHIO_TIMEOUT_MS,
): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { ...authHeaders(), Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    // 5xx: ours (upstream overload) — retry with backoff.
    if (res.status >= 500) {
      logger.warn(CONTEXT, `upstream ${res.status} for ${url}`)
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BASE_RETRY_MS * 2 ** (attempt - 1)))
        return fetchJson<T>(url, token, attempt + 1, timeoutMs)
      }
      return null
    }
    // 4xx: not ours — auth or shape problem, do not retry.
    if (!res.ok) {
      logger.warn(CONTEXT, `upstream ${res.status} for ${url}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (attempt < MAX_RETRIES) {
      logger.warn(CONTEXT, `fetch retry ${attempt} for ${url}: ${msg}`)
      await new Promise((r) => setTimeout(r, BASE_RETRY_MS * 2 ** (attempt - 1)))
      return fetchJson<T>(url, token, attempt + 1, timeoutMs)
    }
    logger.warn(CONTEXT, `fetch failed for ${url}: ${msg}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Mapping ──────────────────────────────────────────────────

/**
 * Map an upstream row onto the shared discovery shape.
 * `riskLevel` is a placeholder (2) like the keyless module: the authoritative
 * concentration numbers arrive through the audit path, and the aggregator
 * overrides riskLevel from the audit when one is available.
 */
function mapRow(entry: AlphioMemeRow): MemeAlphaToken | null {
  const contract = trimmed(entry.mint)
  if (!contract) return null
  const chain = normalizeChainId(trimmed(entry.chain) || 'solana')
  const symbol = trimmed(entry.symbol) || contract

  return {
    id: `${chain}:${contract}`,
    platform: 'alphio',
    chain,
    contract,
    symbol,
    name: trimmed(entry.name) || symbol,
    price: num(entry.price_usd),
    change24h: num(entry.price_change_24h),
    volume24h: num(entry.volume_24h_usd),
    marketCap: num(entry.market_cap_usd),
    liquidity: num(entry.liquidity_usd),
    createdAt: normalizeTimestamp(entry.created_at),
    riskLevel: 2, // placeholder — audit path owns concentration scoring
    holders: num(entry.holders),
    top10HolderPercent: num(entry.top10_holding_pct) / 100,
    social: {
      ...(trimmed(entry.twitter) ? { twitter: trimmed(entry.twitter) } : {}),
      ...(trimmed(entry.telegram) ? { telegram: trimmed(entry.telegram) } : {}),
      ...(trimmed(entry.website) ? { site: trimmed(entry.website) } : {}),
    },
    audited: false,
    provenance: {
      sourceType: 'reverse-engineered',
      provider: 'alphio',
      experimental: true,
      note: 'Member API (Bearer) RE\'d from app.alphio.ai; self-gates when no session.',
    },
    riskKnown: false,
  }
}

function mapList(payload: AlphioListEnvelope | null): MemeAlphaToken[] {
  if (!payload || !retOk(payload.ret) || !Array.isArray(payload.list)) return []
  const out: MemeAlphaToken[] = []
  const seen = new Set<string>()
  for (const row of payload.list as AlphioMemeRow[]) {
    const mapped = mapRow(row)
    if (mapped && !seen.has(mapped.id)) {
      seen.add(mapped.id)
      out.push(mapped)
    }
  }
  return out
}

const LIST_PATHS: Record<string, { path: string; sort: string }> = {
  new: { path: '/v1/crypto/meme/new-tokens', sort: 'newest' },
  near_graduation: { path: '/v1/crypto/meme/new-tokens', sort: 'heat' },
  trending: { path: '/v1/crypto/meme/trending', sort: 'volume' },
  most_held: { path: '/v1/crypto/meme/trending', sort: 'holders' },
  graduated: { path: '/v1/crypto/meme/trending', sort: 'graduated' },
}

// ── Public API ───────────────────────────────────────────────

/** True when a usable Alphio session is configured (env or staged file). */
export function hasAlphioAuth(): boolean {
  return resolveAlphioAccessToken() !== null
}

/**
 * Fetch a discovery kind from the member API.
 * `kind` follows the registry's list kinds; unknown kinds fall back to
 * trending(volume) so the caller contract stays total.
 */
export async function discoverAlphioTokens(
  limit: number = 50,
  kind: string = 'trending',
): Promise<MemeAlphaToken[]> {
  const token = resolveAlphioAccessToken()
  if (!token) return []

  const spec = LIST_PATHS[kind] ?? LIST_PATHS.trending
  const cap = Math.min(Math.max(1, Math.floor(limit) || 1), 100)
  const url = `${BASE}${spec.path}?sort=${spec.sort}&limit=${cap}`
  const payload = await fetchJson<AlphioListEnvelope>(url, token)
  return mapList(payload).slice(0, cap)
}

/** Keyword search (Solana only upstream). Empty keyword short-circuits. */
export async function searchAlphioTokens(keyword: string, limit = 10): Promise<MemeAlphaToken[]> {
  const token = resolveAlphioAccessToken()
  const q = keyword.trim()
  if (!token || !q) return []
  const cap = Math.min(Math.max(1, Math.floor(limit) || 1), 10)
  const url = `${BASE}/v1/crypto/meme/search?chain=solana&keyword=${encodeURIComponent(q)}&limit=${cap}`
  const payload = await fetchJson<AlphioListEnvelope>(url, token)
  return mapList(payload).slice(0, cap)
}

/**
 * Single-token read + concentration audit.
 * The token endpoint alone carries dev/sniper/bundler/insider/top10 splits and
 * safety shield, so the audit needs one call; the holders call adds ranked
 * wallets (with realized PnL) when it succeeds.
 *
 * riskLevel mirrors the keyless module's hard-filter ceilings (spec 2026-10-08):
 *   dev > 2% · sniper > 6% · insider > 5% · bundler > 30% · top10 > 80% -> 3
 *   measured-low concentration -> 1
 *   anything unproven -> 2
 */
export async function auditAlphioToken(
  chain: string,
  contract: string,
): Promise<MemeRiskAudit | null> {
  const token = resolveAlphioAccessToken()
  const mint = trimmed(contract)
  if (!token || !mint) return null

  const canonical = normalizeChainId(chain || 'solana')
  if (!ALPHIO_CHAINS.has(canonical)) return null

  const [tokenPayload, holdersPayload] = await Promise.all([
    fetchJson<AlphioTokenEnvelope>(
      `${BASE}/v1/crypto/meme/token?mint=${encodeURIComponent(mint)}`,
      token,
    ).catch(() => null),
    fetchJson<AlphioHoldersEnvelope>(
      `${BASE}/v1/crypto/meme/holders?mint=${encodeURIComponent(mint)}`,
      token,
    ).catch(() => null),
  ])

  if (!tokenPayload || !retOk(tokenPayload.ret) || !tokenPayload.data) {
    logger.warn(CONTEXT, `audit empty for ${canonical}:${mint}: ${trimmed(tokenPayload?.msg)}`)
    return null
  }

  const d = tokenPayload.data as AlphioMemeRow
  // Upstream reports these as percentages (e.g. 18.015) -> fractions for our shape.
  const top10 = num(d.top10_holding_pct) / 100
  const dev = num(d.dev_holding_pct) / 100
  const sniper = num(d.sniper_pct) / 100
  const insider = num(d.insider_pct) / 100
  const bundler = num(d.bundler_pct) / 100

  const hot = dev > 0.02 || sniper > 0.06 || insider > 0.05 || bundler > 0.3 || top10 > 0.8
  let riskLevel = 2 // absent numbers cannot justify safety
  if (hot) riskLevel = 3
  else if (top10 > 0 && top10 <= 0.5 && dev === 0 && sniper === 0 && insider === 0 && bundler <= 0.1) {
    riskLevel = 1
  }

  const holderList = holdersPayload?.data?.list
  const topWallets: Array<{ address: string; percent: number }> = []
  if (Array.isArray(holderList)) {
    for (const row of (holderList as AlphioHolderRow[]).slice(0, 10)) {
      const addr = trimmed(row.address)
      const pct = num(row.pct_of_supply) / 100
      if (addr && pct > 0) topWallets.push({ address: addr, percent: pct })
    }
  }

  // Top-5 average UNREALIZED PnL percent: (price - avgBuy) / avgBuy * 100.
  // Upstream holders rows carry avg_buy_price_usd and the token row carries the
  // live price — no fabrication. Null when fewer than 5 rows have a cost basis
  // (the sniper maps null to "neutral", never to a made-up value).
  let top5AvgPnlPercent: number | null = null
  const price = num(d.price_usd, NaN)
  if (Array.isArray(holderList) && Number.isFinite(price) && price > 0) {
    const pcts: number[] = []
    for (const row of (holderList as AlphioHolderRow[]).slice(0, 5)) {
      const avgBuy = num(row.avg_buy_price_usd, NaN)
      if (Number.isFinite(avgBuy) && avgBuy > 0) pcts.push(((price - avgBuy) / avgBuy) * 100)
    }
    if (pcts.length === 5) top5AvgPnlPercent = pcts.reduce((a, b) => a + b, 0) / pcts.length
  }

  const riskLabel: MemeRiskAudit['riskLabel'] =
    riskLevel >= 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'

  const outChain = normalizeChainId(trimmed(d.chain) || canonical)
  return {
    id: `${outChain}:${mint}`,
    platform: 'alphio',
    chain: outChain,
    contract: mint,
    symbol: trimmed(d.symbol) || mint,
    name: trimmed(d.name) || trimmed(d.symbol) || mint,
    riskLevel,
    riskLabel,
    buyTax: 0, // not reported by this source
    sellTax: 0, // not reported by this source
    top10HolderPercent: top10,
    lpLockedPercent: -1, // unknown upstream
    canFreeze: false, // not reported by this source
    canMint: false, // not reported by this source
    isHoneypot: false, // not reported by this source
    riskCounts: { high: hot ? 1 : 0, middle: riskLevel === 2 ? 1 : 0, low: 0 },
    distribution: {
      devPercent: dev,
      sniperPercent: sniper,
      bundlerPercent: bundler,
      insiderPercent: insider,
    },
    topWallets: topWallets.length ? topWallets : undefined,
    top5AvgPnlPercent,
    auditedAt: Date.now(),
  }
}

export type { AlphioMemeRow, AlphioListEnvelope, AlphioTokenEnvelope, AlphioHolderRow }