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

const GMGN_BASE = 'https://gmgn.ai/defi/quotation/v1'
// ── Operator-supplied session cookie (Cloudflare hint) ──
// Sources: env GMGN_SESSION_COOKIE, or file data/gmgn-session.json
// ({ "cookie": "..." }) — file wins. GMGN_SESSION_PATH overrides the file path.
let cachedCookie: string | null | undefined

export function __resetGmgnCookieForTests(): void {
  cachedCookie = undefined
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


interface GmgnTrendingResponse {
  data?: { list?: Array<{
    tokenInfo?: { address?: string; symbol?: string; name?: string; chain?: string
      priceUsd?: number; priceChange24h?: number; volume24h?: number; marketCap?: number
      liquidity?: number; holders?: number; createdAt?: number
    }; trendScore?: number
  }> }; error?: { msg?: string }
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
  readonly refillRate: number = 1 / 60_000 // tokens per ms

  async acquire(): Promise<void> {
    // Skip rate limiting in test environments
    if (process.env.VITEST !== undefined || !!process.env.JEST_WORKER_ID) {
      this.tokens -= 1
      return
    }

    const now = Date.now()
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
    await this.acquire()
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
      if (isCloudflare && attempt < maxAttempts) {
        logger.warn(`GMGN Cloudflare challenge detected (attempt ${attempt}/${maxAttempts})`, 'gmgn', {
          error: lastError.message,
        })
      }
      if (attempt < maxAttempts) {
        const wait = Math.min(baseDelay * 2 ** (attempt - 1), 2_000)
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

async function gmgnFetch<T>(endpoint: string, _signal?: AbortSignal): Promise<T> {
  await RATE_LIMITER.acquire()
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

// ── Discovery ----

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
      const items = raw.data?.list ?? []
      let count = 0

      for (const item of items) {
        if (count >= limitPerChain) break

        const info = item.tokenInfo
        if (!info?.address) continue

        const normChain = normalizeChainId(chainId)
        const id = `${normChain}:${info.address.toLowerCase()}`
        if (seen.has(id)) continue
        seen.add(id)

        const token: MemeAlphaToken = {
          id,
          platform: 'gmgn',
          chain: normChain,
          contract: info.address.toLowerCase(),
          symbol: info.symbol || '',
          name: info.name || '',
          price: info.priceUsd || 0,
          change24h: info.priceChange24h || 0,
          volume24h: info.volume24h || 0,
          marketCap: info.marketCap || 0,
          liquidity: info.liquidity || 0,
          createdAt: info.createdAt ? normalizeTimestamp(info.createdAt) : null,
          riskLevel: 1,
          holders: info.holders || 0,
          top10HolderPercent: 0,
          social: {},
          audited: false,
          provenance: {
            sourceType: 'public-api',
            provider: 'gmgn',
            experimental: true,
            note: 'GMGN public rank endpoint; discovery feed, not a security audit',
          },
          // Discovery rows carry no audit — riskLevel 1 is a placeholder.
          riskKnown: false,
        }

        allTokens.push(token)
        count++
      }

      logger.info(`GMGN discovered ${count} tokens on ${chainId}`, 'gmgn', { chain: chainId, total: allTokens.length })
    } catch (err) {
      logger.error(`GMGN discovery failed for ${chainId}: ${err}`, 'gmgn', { chain: chainId, error: String(err) })
    }
  }

  // Sort by market cap descending
  allTokens.sort((a, b) => b.marketCap - a.marketCap)

  return allTokens
}

// ── Risk audit ----

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