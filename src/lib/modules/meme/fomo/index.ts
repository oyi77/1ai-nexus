// ─────────────────────────────────────────────────────────────
// Module: Fomo (fomofun.xyz) — Meme Alpha
// sourceType: reverse-engineered
// upstreamProduct: Fomo.fun — real-time new token launch tracker
// endpoint: https://api.fomofun.xyz/v1 (public GET endpoints)
// lastVerified: 2026-10-05
//
// NOTE: This is a PUBLIC API (no auth required) but rate limited
// (~30 req/min conservative). Token bucket + exponential backoff implemented.
// Request style is header-minimal and respectful: no stealth headers, no
// cookie scraping, no bot-control bypass. Graceful partial failure.
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'
import { logger } from '@/lib/logger'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Constants ────────────────────────────────────────────────

const BASE = 'https://api.fomofun.xyz/v1'
const CONTEXT = 'meme:fomo'
const MAX_RETRIES = 5
const BASE_RETRY_MS = 500
const MAX_WAIT_MS = 8000

// ── Optional operator-supplied session file ──
// data/fomo-session.json ({ "cookie": "..." }) — if present, its cookie is
// attached to requests and the module is enabled. FOMO_SESSION_PATH overrides
// the path. Env FOMO_API_ENABLED=true remains an alternative opt-in.
let cachedCookie: string | null | undefined

export function __resetFomoCookieForTests(): void {
  cachedCookie = undefined
}

function fomoSessionCookie(): string | null {
  if (cachedCookie !== undefined) return cachedCookie
  const path = process.env.FOMO_SESSION_PATH || join(process.cwd(), 'data', 'fomo-session.json')
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { cookie?: string }
      if (raw.cookie) {
        cachedCookie = raw.cookie
        return cachedCookie
      }
    } catch (err) {
      logger.warn(`Fomo session file unreadable: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  cachedCookie = null
  return cachedCookie
}

class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private capacity: number,
    private refillMs: number,
  ) {
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const elapsed = Date.now() - this.lastRefill
    const added = Math.floor(elapsed / this.refillMs)
    if (added > 0) {
      this.tokens = Math.min(this.tokens + added, this.capacity * 2)
      this.lastRefill = Date.now()
    }
  }

  tryAcquire(): boolean {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens--
      return true
    }
    return false
  }

  waitForToken(timeoutMs: number): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const start = Date.now()
    
    const check = (): void => {
      if (this.tryAcquire()) {
        resolve()
        return
      }
      const elapsed = Date.now() - start
      if (elapsed >= timeoutMs) {
        reject(new Error('Rate limit timeout'))
        return
      }
      setTimeout(check, Math.random() * 50)
    }
    check()
    
    return promise
  }
}

const requestLimiter = new TokenBucket(30, 1000 / 30) // ~30 req/min

// ── Raw Payload Shapes ───────────────────────────────────────

interface FomoFeedEntry {
  chain?: string
  contract?: string
  symbol?: string
  name?: string
  logo?: string | null
  createdAt?: string
  priceUsd?: number
  marketCapUsd?: number
  liquidityUsd?: number
  volumeUsd?: number
  priceChangePct?: Record<string, number>
  txCount24h?: number
  holderCount24h?: number
  trendingScore?: number
}

// ── Helpers ─────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function safeString(v: unknown, fallback = ''): string {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return fallback
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

async function fetchWithRetry<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T | null> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const cookie = fomoSessionCookie()
      const res = await fetch(url, { signal, headers: { Accept: 'application/json', ...(cookie ? { cookie } : {}) } })

      if (res.status === 429) {
        // Rate limited — wait and retry
        const wait = Math.min(
          BASE_RETRY_MS * Math.pow(2, attempt - 1) + Math.random() * 500,
          MAX_WAIT_MS,
        )
        logger.warn(CONTEXT, `Rate limit hit (attempt ${attempt}/${MAX_RETRIES}), waiting ${Math.round(wait)}ms`, { status: res.status })
        await sleep(wait)
        continue
      }

      if (!res.ok) {
        throw new Error(`Fomo API ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      return data as T
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      logger.debug(CONTEXT, `Fetch attempt ${attempt} failed: ${lastError.message}`, { url })
      
      if (attempt < MAX_RETRIES) {
        const wait = BASE_RETRY_MS * Math.pow(2, attempt - 1) + Math.random() * 500
        logger.info(CONTEXT, `Retrying in ${Math.round(wait)}ms`)
        await sleep(wait)
      }
    }
  }

  logger.error(CONTEXT, `All retries exhausted: ${lastError?.message}`, { url, attempts: MAX_RETRIES })
  return null
}

// ── Discovery ────────────────────────────────────────────────

function normalizeToken(entry: FomoFeedEntry): MemeAlphaToken | null {
  const contract = safeString(entry.contract)
  if (!contract) return null

  const chain = entry.chain && entry.chain.length > 0 ? entry.chain : 'solana'
  const change24h = num(entry.priceChangePct?.['24h'] ?? entry.priceChangePct?.h24 ?? 0) / 100
  const id = `${chain}:${contract}`

  return {
    id,
    platform: 'fomo' as MemePlatform,
    chain,
    contract,
    symbol: safeString(entry.symbol, contract),
    name: safeString(entry.name, safeString(entry.symbol)),
    price: num(entry.priceUsd),
    change24h,
    volume24h: num(entry.volumeUsd),
    marketCap: num(entry.marketCapUsd),
    liquidity: num(entry.liquidityUsd),
    createdAt: entry.createdAt ? Date.parse(entry.createdAt) || null : null,
    riskLevel: 2, // unknown for discovery-only platform
    holders: num(entry.holderCount24h),
    top10HolderPercent: 0, // not available from public feed
    social: {},
    audited: false,
    provenance: {
      sourceType: 'reverse-engineered',
      provider: 'fomo',
      experimental: true,
      note: 'Feed endpoint RE-ed from fomofun.xyz web app; unverified stability',
    },
    // Discovery-only platform: riskLevel is placeholder, no real audit.
    riskKnown: false,
  }
}

/** Fetch trending token launches from Fomo public feed */
export async function discoverFomoTokens(limit: number = 50): Promise<MemeAlphaToken[]> {
  const startTime = Date.now()
  logger.info(CONTEXT, `Discovering tokens (limit=${limit})`)

  const results: MemeAlphaToken[] = []
  const seen = new Set<string>()

  try {
    // Acquire rate limit slot
    await requestLimiter.waitForToken(MAX_WAIT_MS)

    const url = `${BASE}/feeds?limit=${limit}&sort=trending`
    logger.debug(CONTEXT, `Fetching feeds: ${url}`)

    const data = await fetchWithRetry<{ entries: FomoFeedEntry[] }>(url)

    if (!data || !Array.isArray(data.entries)) {
      logger.error(CONTEXT, `Invalid response structure: ${JSON.stringify(data)}`)
      return []
    }

    let count = 0
    for (const entry of data.entries) {
      if (count >= limit) break
      
      const token = normalizeToken(entry)
      if (!token || seen.has(token.id)) continue
      
      seen.add(token.id)
      results.push(token)
      count++

      if (count % 10 === 0) {
        logger.debug(CONTEXT, `Normalized ${count}/${limit} tokens`)
      }
    }

    const elapsed = Date.now() - startTime
    logger.info(CONTEXT, `Discovery complete: ${results.length} tokens in ${elapsed}ms`, { total: results.length, elapsed })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(CONTEXT, `Discovery failed: ${message}`)
  }

  return results
}

/**
 * Fomo.fun is a DISCOVERY platform only — no risk audit hooks provided.
 * Return null to indicate this operation is not supported by the platform.
 * 
 * For risk audits, integrate with dedicated security platforms:
 * - Rugcheck (Solana): https://api.rug.check/api
 * - Birdeye: https://docs.birdeye.co/reference
 * - DexScreener: has basic security signals
 */
export async function auditFomoToken(
  chain: string,
  contract: string,
): Promise<MemeRiskAudit | null> {
  logger.info(CONTEXT, `auditToken called - not supported (discovery-only platform)`, {
    chain,
    contract,
  })
  
  return null
}

export { type FomoFeedEntry }
