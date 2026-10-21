// ─────────────────────────────────────────────────────────────
// Module: GMGN.ai — Meme Alpha (discovery + risk audit)
// sourceType: public-api
// endpoint: https://gmgn.ai/defi/quotation/v1 (public REST; Cloudflare-protected)
// note: public rank/detail endpoints. No stealth headers, cookie scraping,
//   or challenge bypass — header-minimal requests may see 403 and degrade
//   gracefully. GMGN_SESSION_COOKIE is an optional operator-supplied hint.
// ─────────────────────────────────────────────────────────────

import { MemeAlphaToken, MemeRiskAudit } from '../types'
import { normalizeChainId, normalizeTimestamp } from '../normalize'
import { logger } from '../../../logger'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSessionToken } from '@/lib/modules/derived/db-session-store'

const GMGN_BASE = 'https://gmgn.ai/defi/quotation/v1'
// ── Operator-supplied session cookie (Cloudflare hint) ──
// Sources (precedence): DB SessionToken row (provider 'gmgn', DB-primary
// 2026-10-15) → env GMGN_SESSION_COOKIE → file data/gmgn-session.json
// ({ "cookie": "..." }). GMGN_SESSION_PATH overrides the file path.
// `gmgnSessionCookie()` stays sync for existing callers; the DB layer is
// primed by `primeGmgnCookieFromDb()` (awaited once per gmgnFetch).
let cachedCookie: string | null | undefined

export function __resetGmgnCookieForTests(): void {
  cachedCookie = undefined
}

/**
 * Prime the cookie cache from the DB SessionToken row. Never throws.
 * No-op when a cookie is already cached or the DB has no row.
 */
export async function primeGmgnCookieFromDb(): Promise<void> {
  if (cachedCookie !== undefined && cachedCookie !== null) return
  try {
    const row = await loadSessionToken<{ cookie?: string }>('gmgn')
    if (row?.cookie) cachedCookie = row.cookie
  } catch {
    /* DB unavailable — sync path falls back to env/file */
  }
}

function gmgnSessionCookie(): string | null {
  if (cachedCookie !== undefined) return cachedCookie
  const path = process.env.GMGN_SESSION_PATH || join(process.cwd(), 'data', 'gmgn-session.json')
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { cookie?: string }
      if (raw.cookie) {
        cachedCookie = raw.cookie
        return cachedCookie
      }
    } catch (err) {
      logger.warn(`GMGN session file unreadable: ${err instanceof Error ? err.message : String(err)}`, 'gmgn')
    }
  }
  cachedCookie = process.env.GMGN_SESSION_COOKIE || null
  return cachedCookie
}

const CHAIN_CONFIG: Record<string, { path: string; chainId: string }> = {
  sol: { path: 'sol', chainId: 'solana' },
  eth: { path: 'eth', chainId: 'ethereum' },
  base: { path: 'base', chainId: 'base' },
  bsc: { path: 'bsc', chainId: 'binance-smart-chain' },
  blastr: { path: 'blastr', chainId: 'blast' },
}


// The rank endpoint's live shape (proven 2026-10-09): data.rank[] flat rows
// with snake_case fields — the older data.list[].tokenInfo shape is kept as
// a fallback since the adapter was originally written against it.
interface GmgnRankRow {
  address?: string
  symbol?: string
  name?: string
  chain?: string
  price?: number
  price_change_percent?: number
  volume?: number
  market_cap?: number
  liquidity?: number
  holder_count?: number
  open_timestamp?: number
  /** Top-10 concentration as a fraction (rank rows report it directly). */
  top_10_holder_rate?: number
  twitter_username?: string
  website?: string
  telegram?: string
}

interface GmgnTrendingResponse {
  data?: {
    rank?: GmgnRankRow[]
    list?: Array<{
      tokenInfo?: { address?: string; symbol?: string; name?: string; chain?: string
        priceUsd?: number; priceChange24h?: number; volume24h?: number; marketCap?: number
        liquidity?: number; holders?: number; createdAt?: number
      }; trendScore?: number
    }>
  }
  error?: { msg?: string }
}

// Proven live 2026-10-09: /tokens/{chain}/{addr} returns
// {"code":40000300,"invalid argument"} for every token — the detail path
// that actually works is /tokens/top_buyers/{chain}/{addr} (code:0 with
// holder tags, exit statuses, and the top-70 sniper concentration).
interface GmgnHolderEntry {
  status?: string // hold | bought_more | sold_part | sold | transfered
  wallet_address?: string
  tags?: string[] | null
  maker_token_tags?: string[] | null
}

interface GmgnTopBuyersResponse {
  code?: number
  msg?: string
  data?: {
    holders?: {
      holder_count?: number
      top70_sniper_hold_rate?: string | number
      statusNow?: {
        hold?: number; bought_more?: number; sold_part?: number; sold?: number
        transfered?: number; bought_rate?: string | number; holding_rate?: string | number
        top_10_holder_rate?: number
      }
      holderInfo?: GmgnHolderEntry[]
    }
  }
}

// Proven live 2026-10-09: /vas/api/v1/token_holders/{chain}/{addr} answers
// code:0 with cookie-only auth and carries the per-holder PnL the evaluator
// needs (avg_cost, unrealized_profit, realized_profit, is_suspicious, tags).
interface GmgnTokenHoldersResponse {
  code?: number
  data?: {
    next?: string | null
    list?: Array<{
      address?: string
      amount_percentage?: number
      avg_cost?: number | null
      cost_cur?: number
      usd_value?: number
      unrealized_profit?: number
      realized_profit?: number
      profit?: number
      is_suspicious?: boolean
      tags?: string[] | null
      maker_token_tags?: string[] | null
      wallet_tag_v2?: string | null
    }>
  }
}


// ── Rate limiting: simple token bucket ----

class TokenBucket {
  private tokens: number = 60
  private lastRefill: number = Date.now()
  readonly capacity: number = 60
  // 60 requests per minute == 1 token per second. The previous value
  // (1/60_000) was 1 token per MINUTE — a 60x error that made any pass with
  // more than 60 calls effectively hang: a wallet-discovery run with 307
  // survivors needed ~307 minutes and was killed at 200-300s with no output.
  // Live measurement on 2026-10-20: 24 concurrent wallet-stats calls all
  // succeeded in 11.9s, so 1/s is comfortably inside GMGN's tolerance.
  readonly refillRate: number = 1_000 / 60_000 // tokens per ms

  async acquire(): Promise<void> {
    // Skip rate limiting in test environments
    if (process.env.VITEST !== undefined || !!process.env.JEST_WORKER_ID) {
      this.tokens -= 1
      return
    }

    // Bound the wait: 60s max. A pathological queue (many concurrent
    // discovery callers) previously chained recursive acquire() calls and
    // could hang a whole pass; a timed give-up degrades that call, and the
    // retry/backoff wrapper above decides what to do with it.
    const deadline = Date.now() + 60_000
    for (;;) {
      const now = Date.now()
      if (now > deadline) throw new Error('gmgn rate limiter: 60s acquire timeout')
      const elapsed = now - this.lastRefill
      const toAdd = elapsed * this.refillRate
      this.tokens = Math.min(this.capacity, this.tokens + toAdd)
      this.lastRefill = now

      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      const waitTime = Math.ceil((1 - this.tokens) / this.refillRate)
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, waitTime)
      await promise
    }
  }
}

const RATE_LIMITER = new TokenBucket()

// ── Retry with backoff ----

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  baseDelay = 500,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const isCloudflare = lastError.message.includes('403') || lastError.message.includes('Cloudflare')
      // A 429 is rate limiting, not a challenge: the request was understood
      // and refused. It needs a LONGER wait than the generic ladder, and the
      // failure must be visible — a 429 that exhausts its retries returns an
      // empty holder list, which silently drops the token from the scan.
      const isRateLimited = lastError.message.includes('429')
      if ((isCloudflare || isRateLimited) && attempt < maxAttempts) {
        logger.warn(
          `GMGN ${isRateLimited ? 'rate limited (429)' : 'Cloudflare challenge'} (attempt ${attempt}/${maxAttempts})`,
          'gmgn',
          { error: lastError.message },
        )
      }
      if (attempt < maxAttempts) {
        const wait = isRateLimited
          ? Math.min(baseDelay * 4 ** (attempt - 1), 8_000)
          : Math.min(baseDelay * 2 ** (attempt - 1), 2_000)
        await new Promise((resolve) => setTimeout(resolve, wait))
      }
    }
  }

  const hasCookie = !!gmgnSessionCookie()
  const cookieHint = hasCookie
    ? ''
    : '\n\nTip: Set GMGN_SESSION_COOKIE (env) or data/gmgn-session.json for better Cloudflare handling.'
  throw new Error(`GMGN request failed after ${maxAttempts} attempts.${cookieHint}`)
}

// (REQUEST_TIMEOUT_MS is declared with the curl-child block below.)

// Proven live 2026-10-09: even with browser UA + page referer + session
// cookie, Node fetch still gets the 403 challenge — the blocker is TLS
// fingerprinting, so the transport below (system curl) is required.
const GMGN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36'

// ── curl-child transport ──────────────────────────────────────
// Cloudflare TLS-fingerprints every Node stack (undici fetch → 403
// challenge) while system curl with identical URL+headers+cookie passes
// 200 (proven live 2026-10-09). Mirrors the birdeye/ajaib pattern:
// proxy-stripped env, status capture, module-local test seam.
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1_048_576

/** Env copy with every *proxy* var removed (case-insensitive). */
function directEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (k.toLowerCase().includes('proxy')) delete env[k]
  }
  return env
}

// Injectable seam for tests (defaults to execFileSync). Module-local so
// tests never fight other suites over a global child_process mock.
let runCurl: (args: string[]) => string = (args) =>
  execFileSync('curl', args, {
    env: directEnv(),
    encoding: 'utf8',
    maxBuffer: MAX_RESPONSE_BYTES + 64,
    timeout: REQUEST_TIMEOUT_MS + 2_000,
  }) as string

export function __setGmgnCurlForTests(fn: typeof runCurl | null): void {
  runCurl =
    fn ??
    ((args) =>
      execFileSync('curl', args, {
        env: directEnv(),
        encoding: 'utf8',
        maxBuffer: MAX_RESPONSE_BYTES + 64,
        timeout: REQUEST_TIMEOUT_MS + 2_000,
      }) as string)
}

export async function gmgnFetch<T>(endpoint: string, _signal?: AbortSignal): Promise<T> {
  await RATE_LIMITER.acquire()
  // DB-primary (2026-10-15): prime cookie from SessionToken before the
  // sync fallback. Never throws; no-op when already cached or DB empty.
  await primeGmgnCookieFromDb()
  const cookie = gmgnSessionCookie()
  // Absolute URLs bypass the quotation base (the /vas/* holder endpoints
  // live at the host root, not under /defi/quotation/v1).
  const url = endpoint.startsWith('http') ? endpoint : `${GMGN_BASE}${endpoint}`
  const args = [
    '-sS', '-L', '--http2',
    '--max-time', String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
    '-H', `User-Agent: ${GMGN_UA}`,
    '-H', 'Referer: https://gmgn.ai/',
    '-H', 'Accept: application/json',
    ...(cookie ? ['-H', `Cookie: ${cookie}`] : []),
    '-w', '\nCURL_STATUS:%{http_code}', url,
  ]
  let out: string
  try {
    out = runCurl(args)
  } catch (e) {
    const isRecord = typeof e === 'object' && e !== null
    const code = isRecord && 'code' in e ? String(e.code) : ''
    if (isRecord && (('killed' in e && e.killed === true) || code === 'ETIMEDOUT')) {
      throw new Error(`GMGN request timeout: ${endpoint}`)
    }
    if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error(`GMGN response too large: ${endpoint}`)
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
  const m = /\nCURL_STATUS:(\d{3})\s*$/.exec(out)
  const status = m ? Number(m[1]) : 0
  const body = m ? out.slice(0, m.index) : out
  if (status === 403) throw new Error(`GMGN Cloudflare challenge: ${endpoint}`)
  if (status >= 400 || status === 0) throw new Error(`GMGN HTTP ${status}: ${endpoint}`)
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    throw new Error(`GMGN response too large: ${endpoint}`)
  }
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error(`GMGN parse error: ${endpoint}`)
  }
}

// ── Discovery ----

/** Min volume (USD) for established-token discovery — filters junk micro-caps. */
const ESTABLISHED_MIN_VOLUME_USD = 100_000

/**
 * Map a single GMGN rank/legacy row to a normalized MemeAlphaToken.
 * Shared by both trending and established discovery paths so shape
 * handling stays in one place.
 */
function mapGmgnRowToToken(info: GmgnRankRow, chainId: string): MemeAlphaToken | null {
  if (!info?.address) return null
  const normChain = normalizeChainId(chainId)
  // Solana mints are case-sensitive base58 (live-proven 2026-10-16:
  // GMGN /vas/token_holders/sol/<lowercased> returns 400
  // P_GMGN_WEB_INVALID_ARGUMENT). EVM hex addresses are case-insensitive
  // → lowercase for stable dedup. This matches the repo-wide convention
  // (unified-candidate.ts: "Solana base58 mints are CASE-SENSITIVE").
  const isSolana = normChain === 'solana'
  const contract = isSolana ? info.address : info.address.toLowerCase()
  const id = `${normChain}:${contract}`
  return {
    id,
    platform: 'gmgn',
    chain: normChain,
    contract,
    symbol: info.symbol || '',
    name: info.name || '',
    price: info.price ?? (info as { priceUsd?: number }).priceUsd ?? 0,
    change24h: info.price_change_percent ?? (info as { priceChange24h?: number }).priceChange24h ?? 0,
    volume24h: info.volume ?? (info as { volume24h?: number }).volume24h ?? 0,
    marketCap: info.market_cap ?? (info as { marketCap?: number }).marketCap ?? 0,
    liquidity: info.liquidity ?? 0,
    createdAt: info.open_timestamp
      ? normalizeTimestamp(info.open_timestamp)
      : ((info as { createdAt?: number }).createdAt
        ? normalizeTimestamp((info as { createdAt?: number }).createdAt!)
        : null),
    riskLevel: 1,
    holders: info.holder_count ?? (info as { holders?: number }).holders ?? 0,
    top10HolderPercent: Math.min(1, Math.max(0, info.top_10_holder_rate ?? 0)),
    social: {
      twitter: info.twitter_username ? `https://x.com/${info.twitter_username}` : undefined,
      telegram: info.telegram || undefined,
      site: info.website || undefined,
    },
    audited: false,
    provenance: {
      sourceType: 'public-api',
      provider: 'gmgn',
      experimental: true,
      note: 'GMGN public rank endpoint; discovery feed, not a security audit',
    },
    riskKnown: false,
  }
}

/** Discover trending tokens across supported chains */
export async function discoverGmgnTokens(limitPerChain = 20): Promise<MemeAlphaToken[]> {
  const chains = Object.keys(CHAIN_CONFIG)
  const allTokens: MemeAlphaToken[] = []
  const seen = new Set<string>()

  for (const chainKey of chains) {
    const config = CHAIN_CONFIG[chainKey]
    const endpoint = `/rank/${config.path}/swaps/24h`
    const chainId = config.chainId

    try {
      const raw = await retryWithBackoff(() => gmgnFetch<GmgnTrendingResponse>(endpoint))
      const rankRows = raw.data?.rank ?? []
      const legacyRows = (raw.data?.list ?? []).map((item) => item.tokenInfo).filter((v): v is NonNullable<typeof v> => !!v)
      const items: GmgnRankRow[] = rankRows.length > 0 ? rankRows : legacyRows
      let count = 0

      for (const info of items) {
        if (count >= limitPerChain) break
        const token = mapGmgnRowToToken(info, chainId)
        if (!token) continue
        if (seen.has(token.id)) continue
        seen.add(token.id)
        allTokens.push(token)
        count++
      }

      logger.info(`GMGN discovered ${count} tokens on ${chainId}`, 'gmgn', { chain: chainId, total: allTokens.length })
    } catch (err) {
      logger.error(`GMGN discovery failed for ${chainId}: ${err}`, 'gmgn', { chain: chainId, error: String(err) })
    }
  }

  allTokens.sort((a, b) => b.marketCap - a.marketCap)

  return allTokens
}

/** Options for established-token discovery. */
export interface GmgnEstablishedOpts {
  /** Min token age in hours (default 24). Filters brand-new pump.fun launches. */
  minAgeHours?: number
  /** Min 24h volume in USD (default 100_000). Filters micro-caps worth no scan. */
  minVolumeUsd?: number
}

/**
 * Discover established tokens that GMGN has indexed holders for.
 *
 * The trending feed (`/rank/sol/swaps/24h`) returns both ultra-fresh
 * pump.fun launches (13h old — GMGN has no holder data → 400/empty) and
 * established tokens (1588h+ — 20 holders returned). The same endpoint
 * supports `?orderby=volume&direction=desc` which surfaces high-volume
 * established tokens first (live-proven 2026-10-16).
 *
 * This function requests the volume-sorted feed and filters to age > 24h
 * AND volume ≥ $100k — tokens GMGN has actually indexed. Falls back to
 * the trending feed (then age-filters its results) if the volume-sorted
 * request fails.
 */
export async function discoverEstablishedGmgnTokens(
  limitPerChain = 20,
  opts: GmgnEstablishedOpts = {},
): Promise<MemeAlphaToken[]> {
  const minAgeMs = (opts.minAgeHours ?? 24) * 60 * 60 * 1000
  const minVol = opts.minVolumeUsd ?? ESTABLISHED_MIN_VOLUME_USD
  const now = Date.now()

  const chains = Object.keys(CHAIN_CONFIG)
  const allTokens: MemeAlphaToken[] = []
  const seen = new Set<string>()

  for (const chainKey of chains) {
    const config = CHAIN_CONFIG[chainKey]
    const chainId = config.chainId

    // Volume-sorted established endpoint — surfaces high-volume tokens first.
    const establishedEndpoint = `/rank/${config.path}/swaps/24h?orderby=volume&direction=desc`
    let items: GmgnRankRow[] = []

    try {
      const raw = await retryWithBackoff(() => gmgnFetch<GmgnTrendingResponse>(establishedEndpoint))
      const rankRows = raw.data?.rank ?? []
      const legacyRows = (raw.data?.list ?? []).map((item) => item.tokenInfo).filter((v): v is NonNullable<typeof v> => !!v)
      items = rankRows.length > 0 ? rankRows : legacyRows
    } catch (err) {
      // Fallback: trending feed (no volume sort) then we'll age-filter it.
      logger.warn(
        `GMGN established discovery (volume-sorted) failed for ${chainId}, falling back to trending: ${err}`,
        'gmgn',
        { chain: chainId, error: String(err) },
      )
      try {
        const raw = await retryWithBackoff(() => gmgnFetch<GmgnTrendingResponse>(`/rank/${config.path}/swaps/24h`))
        const rankRows = raw.data?.rank ?? []
        const legacyRows = (raw.data?.list ?? []).map((item) => item.tokenInfo).filter((v): v is NonNullable<typeof v> => !!v)
        items = rankRows.length > 0 ? rankRows : legacyRows
      } catch (fallbackErr) {
        logger.error(`GMGN established fallback also failed for ${chainId}: ${fallbackErr}`, 'gmgn', { chain: chainId, error: String(fallbackErr) })
        continue
      }
    }

    let count = 0
    let skippedAge = 0
    let skippedVol = 0

    for (const info of items) {
      if (count >= limitPerChain) break
      const token = mapGmgnRowToToken(info, chainId)
      if (!token) continue
      if (seen.has(token.id)) continue

      // Age filter — skip tokens younger than minAgeHours.
      // Tokens with null createdAt are kept (age unknown ≠ too young).
      if (token.createdAt !== null && now - token.createdAt < minAgeMs) {
        skippedAge++
        continue
      }

      // Volume filter — skip tokens below minVolumeUsd.
      if (token.volume24h < minVol) {
        skippedVol++
        continue
      }

      seen.add(token.id)
      allTokens.push(token)
      count++
    }

    logger.info(
      `GMGN established discovery ${chainId}: ${count} tokens (skipped ${skippedAge} too-young, ${skippedVol} low-volume)`,
      'gmgn',
      { chain: chainId, count, skippedAge, skippedVol, total: allTokens.length },
    )
  }

  // Volume-descending (established discovery prioritizes volume, not mcap).
  allTokens.sort((a, b) => b.volume24h - a.volume24h)

  return allTokens
}

// ── Risk audit ----

/** One holder row as GMGN reports it, for wallet tracing. */
export interface GmgnHolderRow {
  address: string
  amountPercentage: number
  costCur: number
  usdValue: number
  unrealizedProfit: number | null
  realizedProfit: number | null
  suspicious: boolean
  tags: string[]
}

/**
 * Top holders with real per-holder PnL (cookie-only endpoint, proven live
 * 2026-10-09). Returns [] when the endpoint refuses — never fabricated rows.
 * This is the seed source for wallet tracing, since the public Solana RPC
 * refuses getProgramAccounts/getTokenLargestAccounts (403/429).
 */
export async function listGmgnTokenHolders(chain: string, contract: string): Promise<GmgnHolderRow[]> {
  const chainConfig = Object.values(CHAIN_CONFIG).find((c) => c.chainId === chain)
  if (!chainConfig) return []
  try {
    const res = await retryWithBackoff(() =>
      gmgnFetch<GmgnTokenHoldersResponse>(`https://gmgn.ai/vas/api/v1/token_holders/${chainConfig.path}/${contract}`),
    )
    return (res.data?.list ?? [])
      .filter((h) => typeof h.address === 'string' && h.address.length > 0)
      .map((h) => ({
        address: h.address as string,
        amountPercentage: h.amount_percentage ?? 0,
        costCur: h.cost_cur ?? 0,
        usdValue: h.usd_value ?? 0,
        unrealizedProfit: typeof h.unrealized_profit === 'number' ? h.unrealized_profit : null,
        realizedProfit: typeof h.realized_profit === 'number' ? h.realized_profit : null,
        suspicious: h.is_suspicious === true,
        tags: [...(h.tags ?? []), ...(h.maker_token_tags ?? [])],
      }))
  } catch (err) {
    logger.warn(`GMGN holder list failed for ${contract}: ${err}`, 'gmgn', { contract, error: String(err) })
    return []
  }
}

/** One row of GMGN's wallet leaderboard, with its measured 7d/30d record. */
export interface GmgnWalletRankRow {
  address: string
  tags: string[]
  /** Fraction, not percent (GMGN reports 0.0744 for +7.44%). */
  pnl30d: number | null
  winRate30d: number | null
  realizedProfit30d: number | null
  buyVolume30d: number | null
  txCount30d: number | null
}

export const GMGN_SMART_MONEY_TAGS = ['smart_degen', 'pump_smart_degen'] as const

/**
 * GMGN wallet leaderboard (`/defi/quotation/v1/rank/sol/wallets/{window}`),
 * proven live 2026-10-11: 100 rows with real pnl_30d / winrate_30d /
 * realized_profit_30d. This is the only working source of measured
 * per-wallet performance — the on-chain harvest cannot supply it, because
 * the public RPC 429s under load and returns null for most transactions.
 * Returns [] when the endpoint refuses — never fabricated rows.
 */
export async function listGmgnWalletRank(
  tag: string,
  window: '1d' | '7d' | '30d' = '7d',
): Promise<GmgnWalletRankRow[]> {
  try {
    const res = await retryWithBackoff(() =>
      gmgnFetch<{ code?: number; data?: { rank?: Record<string, unknown>[] } }>(
        `/rank/sol/wallets/${window}?tag=${encodeURIComponent(tag)}`,
      ),
    )
    const rows = res.data?.rank ?? []
    const num = (v: unknown): number | null => {
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
      return Number.isFinite(n) ? n : null
    }
    return rows
      .filter((r): r is Record<string, unknown> & { address: string } => typeof r.address === 'string' && r.address.length > 0)
      .map((r) => ({
        address: r.address,
        tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
        pnl30d: num(r.pnl_30d),
        winRate30d: num(r.winrate_30d),
        realizedProfit30d: num(r.realized_profit_30d),
        buyVolume30d: num(r.volume_30d),
        txCount30d: num(r.txs_30d),
      }))
  } catch (err) {
    logger.warn(`GMGN wallet rank failed (${tag}/${window}): ${err}`, 'gmgn')
    return []
  }
}

/** One wallet's measured 30d record from GMGN's smartmoney endpoint. */
export interface GmgnWalletStats {
  address: string
  /** Fraction, not percent. */
  pnl30d: number | null
  realizedProfit30d: number | null
  buyCount30d: number | null
  sellCount30d: number | null
  /** Fraction of buys that were fast (sniper-like); null when unreported. */
  fastTxRatio: number | null
  honeypotRatio: number | null
  tags: string[]
}

/**
 * Per-wallet 30d record (`/defi/quotation/v1/smartmoney/sol/wallet/{addr}`),
 * proven live 2026-10-11 at ~0.7s per wallet: pnl_30d, realized_profit_30d
 * and buy/sell counts are real. `winrate` and `token_num` come back null on
 * this endpoint — the leaderboard endpoint carries winrate_30d instead.
 * null when the endpoint refuses — never fabricated.
 */
export async function fetchGmgnWalletStats(address: string): Promise<GmgnWalletStats | null> {
  try {
    const res = await retryWithBackoff(() =>
      gmgnFetch<{ code?: number; data?: Record<string, unknown> | null }>(
        `/smartmoney/sol/wallet/${address}`,
      ),
    )
    const d = res.data
    if (!d) return null
    const num = (v: unknown): number | null => {
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
      return Number.isFinite(n) ? n : null
    }
    const risk = (d.risk ?? {}) as Record<string, unknown>
    return {
      address,
      pnl30d: num(d.pnl_30d),
      realizedProfit30d: num(d.realized_profit_30d),
      buyCount30d: num(d.buy_30d),
      sellCount30d: num(d.sell_30d),
      fastTxRatio: num(risk.fast_tx_ratio),
      honeypotRatio: num(risk.token_honeypot_ratio),
      tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
    }
  } catch (err) {
    logger.warn(`GMGN wallet stats failed for ${address}: ${err}`, 'gmgn', { error: String(err) })
    return null
  }
}
/**
 * Per-holder PnL for the token's top holders (live-proven 2026-10-09).
 * Returns null when the endpoint refuses or reports nothing, so callers
 * keep "unproven" semantics instead of inventing zeros.
 */
async function fetchHolderPnl(
  chainPath: string,
  contract: string,
): Promise<{ avgPnlPercent: number | null; topWallets: MemeRiskAudit['topWallets']; suspiciousCount: number } | null> {
  try {
    const res = await retryWithBackoff(() => gmgnFetch<GmgnTokenHoldersResponse>(`https://gmgn.ai/vas/api/v1/token_holders/${chainPath}/${contract}`))
    const list = res.data?.list
    if (!list || list.length === 0) return null

    const top5 = list.slice(0, 5)
    const pnls = top5
      .map((h) => {
        // GMGN reports cost + current USD value; PnL% = value/cost - 1.
        const cost = h.cost_cur ?? 0
        const value = h.usd_value ?? 0
        if (cost > 0 && value > 0) return (value / cost - 1) * 100
        if (typeof h.unrealized_profit === 'number' && cost > 0) return (h.unrealized_profit / cost) * 100
        return null
      })
      .filter((v): v is number => v !== null && Number.isFinite(v))

    const avgPnlPercent = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null

    const TaintTags = new Set(['sniper', 'fresh_wallet', 'bundler', 'insider', 'dev'])
    const topWallets = top5.map((h) => ({
      address: h.address ?? '',
      percent: Math.min(1, Math.max(0, h.amount_percentage ?? 0)),
      insider:
        h.is_suspicious === true ||
        (h.tags ?? []).some((t) => TaintTags.has(t)) ||
        (h.maker_token_tags ?? []).some((t) => TaintTags.has(t)),
    }))

    return {
      avgPnlPercent,
      topWallets,
      suspiciousCount: list.filter((h) => h.is_suspicious === true).length,
    }
  } catch (err) {
    logger.warn(`GMGN holder PnL failed for ${contract}: ${err}`, 'gmgn', { contract, error: String(err) })
    return null
  }
}

/**
 * Audit token status via the top_buyers endpoint (the only GMGN detail
 * path proven to answer: code:0 for WIF + a fresh pump token 2026-10-09;
 * /tokens/{chain}/{addr} answers 40000300 "invalid argument" for all).
 *
 * What this endpoint really reports (honest mapping, nothing invented):
 *   - top_10_holder_rate       → top10HolderPercent (pool wallets excluded)
 *   - top70_sniper_hold_rate   → distribution.sniperPercent
 *   - statusNow.holding_rate   → bundlerSoldPercent = (1 - holding_rate)*100
 *     (cohort = top buyers at launch, i.e. snipers/bundlers; pemp proved
 *      1.02e-11 holding rate = 100% sold — the rug signature)
 *   - holderInfo[].tags        → topWallets taint (fallback)
 *
 * A second cookie-only endpoint supplies the holder PnL leg:
 *   - /vas/api/v1/token_holders/{chain}/{addr}
 *       list[].cost_cur + usd_value → top5AvgPnlPercent (real PnL per holder)
 *       list[].amount_percentage    → topWallets percent
 *       list[].is_suspicious/tags   → topWallets insider taint
 * Both calls are error-isolated: a PnL failure keeps the status-derived
 * topWallets and leaves PnL null (unproven), never zero.
 *
 * Mint/freeze/honeypot/tax are NOT reported by either endpoint → booleans
 * stay false (unreported) and the sniper merger excludes gmgn from
 * authority trust.
 */
export async function auditGmgnToken(
  chain: string,
  contract: string,
): Promise<MemeRiskAudit | null> {
  const chainConfig = Object.values(CHAIN_CONFIG).find((c) => c.chainId === chain)
  if (!chainConfig) {
    logger.debug(`GMGN unknown chain: ${chain}`, 'gmgn', { chain })
    return null
  }

  try {
    const endpoint = `/tokens/top_buyers/${chainConfig.path}/${contract}`
    const raw = await retryWithBackoff(() => gmgnFetch<GmgnTopBuyersResponse>(endpoint))
    const holders = raw.data?.holders

    if (!holders) {
      logger.debug('GMGN no holders data for token', 'gmgn', { chain, contract })
      return null
    }

    // Real payload nests this under statusNow (proven live 2026-10-09).
    const top10HolderPercent = Math.min(1, Number(holders.statusNow?.top_10_holder_rate ?? 0))
    const sniperPercent = Math.min(1, Number(holders.top70_sniper_hold_rate ?? 0))
    const holdingRate = Math.min(1, Math.max(0, Number(holders.statusNow?.holding_rate ?? 1)))
    const bundlerSoldPercent = Math.round((1 - holdingRate) * 100 * 10) / 10

    // Per-holder PnL + taint from the holders endpoint (richer than the
    // status list: real percents, avg cost, is_suspicious). Falls back to
    // the top_buyers status list when that endpoint refuses.
    const pnl = await fetchHolderPnl(chainConfig.path, contract)

    let topWallets: MemeRiskAudit['topWallets']
    if (pnl) {
      topWallets = pnl.topWallets
    } else {
      const TaintTags = new Set(['sniper', 'fresh_wallet'])
      topWallets = (holders.holderInfo ?? [])
        .filter((h) => h.status !== 'sold' && h.status !== 'transfered')
        .slice(0, 5)
        .map((h) => ({
          address: h.wallet_address ?? '',
          percent: 0, // unknown on this endpoint; taint gate keys on kind
          insider:
            (h.tags ?? []).some((t) => TaintTags.has(t)) ||
            (h.maker_token_tags ?? []).some((t) => TaintTags.has(t)),
        }))
    }

    const riskLevel = top10HolderPercent > 0.5 ? 3 : top10HolderPercent > 0.3 ? 2 : 1
    const riskLabel = riskLevel === 3 ? 'high' : riskLevel === 2 ? 'middle' : 'low'

    logger.info(`GMGN audited token ${contract}`, 'gmgn', {
      chain,
      contract,
      riskLevel,
      top10HolderPercent,
      sniperPercent,
      bundlerSoldPercent,
      top5AvgPnlPercent: pnl?.avgPnlPercent ?? null,
    })

    return {
      id: `${chain}:${contract}`,
      platform: 'gmgn',
      chain,
      contract: contract.toLowerCase(),
      symbol: '',
      name: '',
      riskLevel,
      riskLabel,
      // Tax/authority not reported by top_buyers — zeros are placeholders
      // the evaluator never trusts (gmgn is outside TRUSTED_SECURITY).
      buyTax: 0,
      sellTax: 0,
      top10HolderPercent,
      lpLockedPercent: -1, // unknown from GMGN
      // Top-holder taint feeds the sniper's top-1-3 gate.
      topWallets,
      canFreeze: false, // unreported — never "proven off" (see TRUSTED_SECURITY)
      canMint: false,
      isHoneypot: false,
      riskCounts: {
        high: riskLevel >= 3 ? 1 : 0,
        middle: riskLevel === 2 ? 1 : 0,
        low: riskLevel === 1 ? 1 : 0,
      },
      distribution: {
        sniperPercent,
        bundlerSoldPercent,
        // insider share not reported by this endpoint — stays absent
        // (unproven), never zero.
      },
      /** Top-5 holder average unrealized PnL in percent (null = unproven). */
      top5AvgPnlPercent: pnl?.avgPnlPercent ?? null,
      auditedAt: Date.now(),
    }
  } catch (err) {
    logger.debug(`GMGN audit failed for ${contract}: ${err}`, 'gmgn', { chain, contract, error: String(err) })
    return null
  }
}

// ── Test hooks ----

/** @internal Clear rate limiter state for tests */
export function __resetGmgnRateLimiterForTests(): void {
  // Currently no persistent state to reset
}

/** @internal Exposed for tests */
export function __gmgnSessionCookieForTests(): string | null {
  return gmgnSessionCookie()
}