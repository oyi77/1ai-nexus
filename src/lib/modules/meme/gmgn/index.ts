// ─────────────────────────────────────────────────────────────
// Module: GMGN.ai — Meme Alpha (discovery + risk audit)
// sourceType: public-api
// endpoint: https://gmgn.ai/defi/quotation/v1 (public REST; Cloudflare-protected)
// note: public rank/detail endpoints. No stealth headers, cookie scraping,
//   or challenge bypass — header-minimal requests may see 403 and degrade
//   gracefully. GMGN_SESSION_COOKIE is an optional operator-supplied hint.
// ─────────────────────────────────────────────────────────────

import { MemeAlphaToken, MemeRiskAudit } from '../types'
import { logger } from '../../../logger'

const GMGN_BASE = 'https://gmgn.ai/defi/quotation/v1'

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

interface GmgnTokenDetailResponse {
  data?: { basicInfo?: { address?: string; symbol?: string; name?: string; chain?: string
    isHoneypot?: boolean; isMintable?: boolean; freezeAuthorityAddress?: string | null
  }; assetInfo?: { buyTax?: number; sellTax?: number; liquidity?: number; holderCount?: number
  }; topHolderList?: Array<{ address?: string; percent?: number }> }; error?: { msg?: string }
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

  const cookieHint = process.env.GMGN_SESSION_COOKIE
    ? ''
    : '\n\nTip: Set GMGN_SESSION_COOKIE environment variable for better Cloudflare handling.'
  throw new Error(`GMGN request failed after ${maxAttempts} attempts.${cookieHint}`)
}

const REQUEST_TIMEOUT_MS = 10_000

async function gmgnFetch<T>(endpoint: string, signal?: AbortSignal): Promise<T> {
  await RATE_LIMITER.acquire()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const res = await fetch(`${GMGN_BASE}${endpoint}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      const reason = res.status === 403 ? 'Cloudflare challenge' : `HTTP ${res.status}`
      throw new Error(`GMGN ${reason}: ${endpoint}`)
    }
    return await res.json() as T
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

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

        const id = `${chainId}:${info.address.toLowerCase()}`
        if (seen.has(id)) continue
        seen.add(id)

        const token: MemeAlphaToken = {
          id,
          platform: 'gmgn',
          chain: chainId,
          contract: info.address.toLowerCase(),
          symbol: info.symbol || '',
          name: info.name || '',
          price: info.priceUsd || 0,
          change24h: info.priceChange24h || 0,
          volume24h: info.volume24h || 0,
          marketCap: info.marketCap || 0,
          liquidity: info.liquidity || 0,
          createdAt: info.createdAt || null,
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

/** Audit token security status */
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
    const endpoint = `/tokens/${chainConfig.path}/${contract}`
    const raw = await retryWithBackoff(() => gmgnFetch<GmgnTokenDetailResponse>(endpoint))
    const data = raw.data

    if (!data) {
      logger.debug('GMGN no data for token', 'gmgn', { chain, contract })
      return null
    }

    const basic = data.basicInfo || {}
    const assets = data.assetInfo || {}
    const topHolders = data.topHolderList ?? []

    const top10 = topHolders.slice(0, 10)
    const top10Sum = top10.reduce((sum, h) => sum + (h.percent || 0), 0)
    const top10HolderPercent = top10Sum > 100 ? top10Sum / 100 : top10Sum

    const isHoneypot = basic.isHoneypot ?? false
    // GMGN reports taxes as percentages (0-100); >10% = heavy tax → middle risk.
    const heavyTax = (assets.buyTax ?? 0) > 10 || (assets.sellTax ?? 0) > 10
    const riskLevel = isHoneypot ? 3 : heavyTax ? 2 : 1
    const riskLabel = riskLevel === 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'

    const riskCounts = {
      high: riskLevel >= 3 ? 1 : 0,
      middle: riskLevel === 2 ? 1 : 0,
      low: riskLevel === 1 ? 1 : 0,
    }

    logger.info(`GMGN audited token ${contract}`, 'gmgn', {
      chain,
      contract,
      riskLevel,
      isHoneypot,
    })

    return {
      id: `${chain}:${contract}`,
      platform: 'gmgn',
      chain,
      contract: contract.toLowerCase(),
      symbol: basic.symbol || '',
      name: basic.name || '',
      riskLevel,
      riskLabel,
      buyTax: (assets.buyTax ?? 0) / 100, // convert from percentage
      sellTax: (assets.sellTax ?? 0) / 100,
      top10HolderPercent,
      lpLockedPercent: -1, // unknown from GMGN
      canFreeze: !!basic.freezeAuthorityAddress,
      canMint: basic.isMintable ?? false,
      isHoneypot,
      riskCounts,
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
