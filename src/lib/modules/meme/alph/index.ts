// ─────────────────────────────────────────────────────────────
// Module: Alph (alph.ai) — Meme Alpha
// sourceType: public-api
// upstreamProduct: Alph.ai smart-web-gateway
// endpoints (verified 2026-10-09, keyless, header-minimal):
//   discovery:
//     GET https://b.alph.ai/smart-web-gateway/hotpage/volume?chain={sol|bsc|base|eth|robinhood}&page={n}&size={n}
//     GET https://b.alph.ai/smart-web-gateway/hotpage/gainer?chain={...}&page={n}&size={n}
//     GET https://b.alph.ai/smart-web-gateway/trade/snipe/graduatedList
//   audit/detail:
//     GET https://b.alph.ai/seo-web-gateway/token/token-seo?chain={...}&token={addr}
// probe evidence 2026-10-09:
//   - bare header-minimal GET (no Origin/Referer/UA) returns 200; Node fetch
//     reaches b.alph.ai clean (200) — no curl-child transport needed.
//   - volume pagination is scroll-style: page=1&size=10 vs page=2&size=10
//     overlap 10/10; page=99 returns 10 rows (never empty); per-page ceiling
//     100 (size=200 still returns 100). Single-shot size=100 preferred.
//   - `r` is a ratio, not a percentage: HeeHaw r=55.2951 renders "+55.5x",
//     VVV r=-0.0763 renders "-8.3%" on alph.ai SSR.
//   - volume rows carry no vol24h (ba/sa buy/sell amounts summed as proxy);
//     graduated rows carry no price/holders/social.
//   - graduatedList/almostList/mainstreamList/sameNameList return bare data[]
//     (no .data.list envelope); topic/tokens returns {total,page,pageSize,list}.
//   - 12 rapid requests all 200 in ~4s — generous rate limit, no bucket needed.
//   - sherlock/popular_token and tracker/x/hotList return code 500 (auth-walled,
//     skipped); smart/tags returns [] (empty, skipped).
// headers: Origin=https://alph.ai, Referer=https://alph.ai/, Accept=application/json
// lastVerified: 2026-10-09
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'
import { normalizeChainId, normalizeTimestamp } from '../normalize'
import { logger } from '@/lib/logger'

// ── Constants ────────────────────────────────────────────────

const BASE = 'https://b.alph.ai/smart-web-gateway'
const SEO_BASE = 'https://b.alph.ai/seo-web-gateway'
const CONTEXT = 'meme:alph'
const ALPH_TIMEOUT_MS = 12_000
const MAX_RETRIES = 3
const BASE_RETRY_MS = 800

// ── Raw Payload Shapes ───────────────────────────────────────

interface AlphVolumeEntry {
  tokenAddress: string
  chain: string
  icon: string
  tokenCode: string
  tokenFullName: string
  tokenCreateTime: number
  poolCreateTime: number
  openTime: number
  price: string
  marketCap: string
  liquidity: number
  bc: string
  sc: string
  r: string
  holders: number
  ba: number
  sa: number
  hotTopic: boolean
  hotTopicTitle: string
  hotScore: string
  platformId: number
  social: { twitter?: string; website?: string; telegram?: string }
  label: string
  sentence: string
  paragraph: string
}

interface AlphGainerEntry {
  tokenAddress: string
  chain: string
  icon: string
  tokenCode: string
  tokenFullName: string
  tokenCreateTime: number
  price: string
  marketCap: string
  r: string
  platformId: number
  label: string
  social: { twitter?: string; website?: string; telegram?: string }
  holders: number
  vol24h: string
  netInflow24h: string
  openTime: number
  poolCreateTime: number
}

interface AlphGraduatedEntry {
  chain: string
  tokenAddress: string
  icon: string
  code: string
  tokenCreateTime: number
  poolTime: number
  label: string
  vol: string
  marketCap: string
  r: string
  progress?: string
  platformId?: string
}

interface AlphVolumeResponse {
  code: string
  msg: string
  data: {
    version: number
    updatedAt: number
    chain: string
    klineTime: string
    total: number
    size: number
    list: AlphVolumeEntry[]
  }
}

interface AlphGainerResponse {
  code: string
  msg: string
  data: {
    version: number
    updatedAt: number
    chain: string
    list: AlphGainerEntry[]
  }
}

interface AlphGraduatedResponse {
  code: string
  msg: string
  data: AlphGraduatedEntry[]
}

interface AlphTokenSeoResponse {
  code: string
  msg: string
  data: {
    chain: string
    tokenAddress: string
    code: string
    fullName: string
    price: number
    priceUsdt: number
    chg24h: number
    marketCap: number
    poolLiquidity: number
    vol24h: number
    top10: number
    holdersNum: number
    aiNarrativeSentence: string
    aiNarrativeParagraph: string
  }
}

// ── Helpers ─────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function trimmed(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

class AlphNonRetryableError extends Error {}

async function fetchWithRetry<T>(
  url: string,
  signal?: AbortSignal,
  attempt = 1,
): Promise<T | null> {
  const controller = new AbortController()
  const onExternalAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  const timeoutId = setTimeout(() => controller.abort(), ALPH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Origin: 'https://alph.ai',
        Referer: 'https://alph.ai/',
        Accept: 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const errMsg = `Alph ${res.status}: ${url} — ${body.slice(0, 200)}`
      if (res.status === 429 || res.status >= 500) throw new Error(errMsg)
      throw new AlphNonRetryableError(errMsg)
    }

    return (await res.json()) as T
  } catch (err) {
    if (err instanceof AlphNonRetryableError) throw err
    if (controller.signal.aborted) throw new Error('request aborted')
    if (attempt < MAX_RETRIES && !signal?.aborted) {
      // Zero retry sleeps under test timers (skill: tracker-meme-adapter-wiring).
      if (process.env.VITEST === undefined && !process.env.JEST_WORKER_ID) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, BASE_RETRY_MS * 2 ** (attempt - 1) + Math.random() * 200)
        await promise
      }
      return fetchWithRetry<T>(url, signal, attempt + 1)
    }
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

// ── Discovery Normalizer ────────────────────────────────────

function toMemeAlphaToken(
  entry: AlphVolumeEntry | AlphGainerEntry | AlphGraduatedEntry,
): MemeAlphaToken | null {
  const chain = normalizeChainId(entry.chain)
  if (!chain) return null

  const contract = trimmed(entry.tokenAddress)
  if (!contract) return null

  // Graduated rows use `code`; volume/gainer rows use `tokenCode`.
  const symbol = ('tokenCode' in entry ? trimmed(entry.tokenCode) : trimmed(entry.code)) || contract
  // Graduated rows carry no full name — fall back to symbol.
  const name = ('tokenFullName' in entry ? trimmed(entry.tokenFullName) : '') || symbol

  // Volume rows carry no vol24h — ba/sa (buy/sell amounts) summed as proxy.
  let volume24h: number
  if ('vol24h' in entry) volume24h = num(entry.vol24h)
  else if ('vol' in entry) volume24h = num(entry.vol)
  else volume24h = num(entry.ba) + num(entry.sa)

  return {
    id: `${chain}:${contract}`,
    platform: 'alph' as MemePlatform,
    chain,
    contract,
    symbol,
    name,
    price: 'price' in entry ? num(entry.price) : 0,
    // `r` is a ratio, not a percentage (probe 2026-10-09: r=55.2951 renders
    // "+55.5x", r=-0.0763 renders "-8.3%" on alph.ai SSR).
    change24h: num(entry.r),
    volume24h,
    marketCap: num(entry.marketCap),
    liquidity: 'liquidity' in entry ? num(entry.liquidity) : 0,
    createdAt: normalizeTimestamp(entry.tokenCreateTime),
    riskLevel: 2, // discovery-only feed: placeholder, no real audit
    holders: 'holders' in entry ? num(entry.holders) : 0,
    top10HolderPercent: 0, // not available on discovery feeds
    social:
      'social' in entry
        ? {
            ...(trimmed(entry.social.twitter) ? { twitter: trimmed(entry.social.twitter) } : {}),
            ...(trimmed(entry.social.telegram) ? { telegram: trimmed(entry.social.telegram) } : {}),
            ...(trimmed(entry.social.website) ? { site: trimmed(entry.social.website) } : {}),
          }
        : {},
    audited: false,
    provenance: {
      sourceType: 'public-api',
      provider: 'alph',
      experimental: true,
      note: 'Alph.ai smart-web-gateway discovery feed (volume/gainer/graduated), not a security audit',
    },
    // Discovery rows carry no audit — riskLevel 2 is a placeholder.
    riskKnown: false,
  }
}

// ── Discovery ────────────────────────────────────────────────

/**
 * Fetch trending tokens from Alph.ai public feeds (volume + gainer +
 * graduated lists, deduplicated by id). Single-shot size=100 per feed —
 * volume pagination is scroll-style (overlapping pages, never-empty
 * terminal page), so pagination is never used.
 */
export async function discoverAlphTokens(limit: number = 50): Promise<MemeAlphaToken[]> {
  const startTime = Date.now()
  const lim = Math.min(Math.max(Math.floor(limit), 1), 200)

  logger.info(CONTEXT, `Discovering tokens (limit=${lim})`)

  const results: MemeAlphaToken[] = []
  const seen = new Set<string>()

  const [volumeResp, gainerResp, graduatedResp] = await Promise.allSettled([
    fetchWithRetry<AlphVolumeResponse>(`${BASE}/hotpage/volume?size=100`),
    fetchWithRetry<AlphGainerResponse>(`${BASE}/hotpage/gainer?size=100`),
    fetchWithRetry<AlphGraduatedResponse>(`${BASE}/trade/snipe/graduatedList`),
  ])

  // Total failure propagates to the route's per-platform error isolation so
  // the platform status reports an error instead of a silent empty list;
  // partial failure keeps whatever feeds succeeded.
  if (
    volumeResp.status === 'rejected' &&
    gainerResp.status === 'rejected' &&
    graduatedResp.status === 'rejected'
  ) {
    const reason = volumeResp.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    logger.error(CONTEXT, `Discovery failed: ${message}`)
    throw reason instanceof Error ? reason : new Error(message)
  }

  const feeds: Array<AlphVolumeEntry[] | AlphGainerEntry[] | AlphGraduatedEntry[]> = []
  if (volumeResp.status === 'fulfilled' && Array.isArray(volumeResp.value?.data?.list)) {
    feeds.push(volumeResp.value.data.list)
  }
  if (gainerResp.status === 'fulfilled' && Array.isArray(gainerResp.value?.data?.list)) {
    feeds.push(gainerResp.value.data.list)
  }
  if (graduatedResp.status === 'fulfilled' && Array.isArray(graduatedResp.value?.data)) {
    feeds.push(graduatedResp.value.data)
  }

  for (const feed of feeds) {
    for (const entry of feed) {
      if (results.length >= lim) break
      const token = toMemeAlphaToken(entry)
      if (token && !seen.has(token.id)) {
        seen.add(token.id)
        results.push(token)
      }
    }
    if (results.length >= lim) break
  }

  const elapsed = Date.now() - startTime
  logger.info(CONTEXT, `Discovery complete: ${results.length} tokens in ${elapsed}ms`, {
    total: results.length,
    elapsed,
  })

  return results
}

// ── Risk Audit ──────────────────────────────────────────────

/**
 * Per-token detail from the keyless Alph.ai SEO gateway
 * (priceUsdt, chg24h percentage, marketCap, poolLiquidity, vol24h,
 * top10 fraction, holdersNum). No tax/freeze/mint/honeypot signals —
 * riskLevel is a top10-concentration + holder-count heuristic.
 */
export async function auditAlphToken(
  chain: string,
  contract: string,
): Promise<MemeRiskAudit | null> {
  const normChain = normalizeChainId(chain)
  if (!normChain || !trimmed(contract)) return null

  const url = `${SEO_BASE}/token/token-seo?chain=${normChain}&token=${contract}`

  try {
    const res = await fetchWithRetry<AlphTokenSeoResponse>(url)
    if (!res || res.code !== '200' || !res.data) {
      logger.warn(CONTEXT, `Audit empty for ${normChain}:${contract}: ${res?.code} ${res?.msg}`)
      return null
    }

    const d = res.data
    let riskLevel = 1
    if (num(d.top10) > 0.8) riskLevel = 3
    else if (num(d.top10) > 0.5) riskLevel = 2
    else if (num(d.holdersNum) < 50) riskLevel = 2

    const label: MemeRiskAudit['riskLabel'] =
      riskLevel >= 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'

    return {
      id: `${normChain}:${contract}`,
      platform: 'alph',
      chain: normChain,
      contract,
      symbol: trimmed(d.code),
      name: trimmed(d.fullName),
      riskLevel,
      riskLabel: label,
      buyTax: 0, // not reported by this source
      sellTax: 0, // not reported by this source
      top10HolderPercent: num(d.top10),
      lpLockedPercent: -1, // unknown
      canFreeze: false, // not reported by this source
      canMint: false, // not reported by this source
      isHoneypot: false, // not reported by this source
      riskCounts: { high: 0, middle: 0, low: 0 },
      auditedAt: Date.now(),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(CONTEXT, `Audit failed for ${normChain}:${contract}: ${message}`)
    return null
  }
}

export type { AlphVolumeEntry, AlphGainerEntry, AlphGraduatedEntry, AlphTokenSeoResponse }