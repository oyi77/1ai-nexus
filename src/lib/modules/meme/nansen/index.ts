// ─────────────────────────────────────────────────────────────
// Module: Nansen (nansen.ai) — Meme Alpha Smart Money Screener
// upstreamProduct: Nansen — blockchain intelligence & smart money tracking
// endpoint: https://api.nansen.ai/v1
// auth: Bearer API key via `apikey` header
// discoveredVia: public API documentation
// lastVerified: 2026-10-04
//
// NOTES:
//   - Token Screener endpoint supports trader_type="sm" for smart money filters
//   - Contract/risk analytics endpoints vary by subscription tier; not all are public
//   - Rate limiting: conservative 60 req/min bucket (adjust based on plan)
// ─────────────────────────────────────────────────────────────

import { z } from 'zod'
import { logger } from '@/lib/logger'
import type { MemeAlphaToken, MemeRiskAudit } from '../types'

// ───────────────────── ENV & CONFIG ────────────────────────

function getNansenApiKey(): string | undefined {
  return process.env.MOBY_NANSEN_API_KEY
}
const NANSEN_BASE_URL = 'https://api.nansen.ai/v1'
const NANSEN_RATE_LIMIT_PER_MIN = 60 // conservative default
const NANSEN_RETRY_ATTEMPTS = 5
const NANSEN_RETRY_BASE_MS = 500

// ───────────────────── NANSEN-SPECIFIC TYPES ──────────────────

/**
 * Nansen Token Screener response data (smart money filtered).
 * See: https://docs.nansen.ai/api/token-god-mode/token-screener.md
 */
export interface NansenTokenScreenerData {
  chain: string
  token_address: string
  token_symbol: string
  token_age_days?: number
  token_age_hours?: number
  token_deployment_date?: string
  market_cap_usd?: number
  liquidity?: number
  price_usd?: number
  price_change?: number
  fdv?: number
  fdv_mc_ratio?: number
  nof_traders?: number
  buy_volume?: number
  sell_volume?: number
  volume?: number
  netflow?: number
  inflow_fdv_ratio?: number
  outflow_fdv_ratio?: number
}

/** Full Nansen token screener response */
export interface NansenTokenScreenerResponse {
  data: NansenTokenScreenerData[]
  pagination: {
    page: number
    per_page: number
    is_last_page: boolean
  }
}

/** Risk metrics from Nansen contract analytics (if available) */
export interface NansenRiskMetrics {
  overall_risk_score: number      // 0-10 scale
  honeypot_risk: number           // 0-10
  liquidity_risk: number          // 0-10
  holder_concentration_risk: number // 0-10
  contract_auth_risk: number      // 0-10 (mint/freeze)
  top_10_holder_pct?: number
  lp_locked_pct?: number
  can_freeze?: boolean
  can_mint?: boolean
}

/** Nansen contract analyzer response (varies by product tier) */
export interface NansenContractAnalyticsResponse {
  contract_address: string
  chain: string
  risk_metrics?: NansenRiskMetrics
  auditor_notes?: string
}

// ───────────────────── RESPONSE VALIDATION SCHEMAS ────────────

const NansenTokenSchema = z.object({
  chain: z.string(),
  token_address: z.string(),
  token_symbol: z.string(),
  token_age_days: z.number().optional(),
  token_age_hours: z.number().optional(),
  token_deployment_date: z.string().optional(),
  market_cap_usd: z.number().optional(),
  liquidity: z.number().optional(),
  price_usd: z.number().optional(),
  price_change: z.number().optional(),
  fdv: z.number().optional(),
  fdv_mc_ratio: z.number().optional(),
  nof_traders: z.number().optional(),
  buy_volume: z.number().optional(),
  sell_volume: z.number().optional(),
  volume: z.number().optional(),
  netflow: z.number().optional(),
  inflow_fdv_ratio: z.number().optional(),
  outflow_fdv_ratio: z.number().optional(),
})

const NansenScreenerResponseSchema = z.object({
  data: z.array(NansenTokenSchema),
  pagination: z.object({
    page: z.number(),
    per_page: z.number(),
    is_last_page: z.boolean(),
  }),
})

// ───────────────────── HELPER FUNCTIONS ───────────────────────

/** Sleep with exponential backoff + jitter */
async function sleepWithBackoff(attempt: number): Promise<void> {
  const baseDelay = NANSEN_RETRY_BASE_MS * Math.pow(2, attempt)
  const jitter = Math.random() * 0.5 * baseDelay // ±50% jitter
  await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter))
}

/** Make authenticated request to Nansen with retry logic */
async function fetchNansen<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getNansenApiKey()
  if (!apiKey) {
    throw new Error('MOBY_NANSEN_API_KEY not configured')
  }

  let lastError: Error | null = null

/** Error thrown for permanent (non-retryable) API failures, e.g. 401/403 */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

  for (let attempt = 0; attempt < NANSEN_RETRY_ATTEMPTS; attempt++) {

      try {
        const url = `${NANSEN_BASE_URL}${endpoint}`
        const headers = {
          'Content-Type': 'application/json',
          apikey: apiKey,
          ...options.headers,
        }

        const res = await fetch(url, {
          ...options,
          headers,
        })

        if (!res.ok) {
          const errorText = await res.text()
          logger.warn(`nansen HTTP ${res.status}: ${errorText}`, 'meme-nansen', {
            endpoint,
            attempt,
          })

          // 429 and 5xx are retryable; all other 4xx are permanent failures
          if (res.status === 429 || res.status >= 500) {
            lastError = new Error(`Nansen API error: ${res.status}`)
            await sleepWithBackoff(attempt)
            continue
          }

          throw new NonRetryableError(`Nansen API error ${res.status}: ${errorText}`)
        }

        return (await res.json()) as T
      } catch (e) {
        if (e instanceof NonRetryableError) throw e

        lastError = e instanceof Error ? e : new Error(String(e))

        if (attempt === NANSEN_RETRY_ATTEMPTS - 1) break

        await sleepWithBackoff(attempt)
      }
  }

  throw lastError ?? new Error('Nansen request failed after retries')
}

// ───────────────────── DISCOVERY ENDPOINT ─────────────────────

/**
 * Discover trending tokens via Nansen Smart Money screener.
 * Filters for tokens with smart money activity (trader_type=sm).
 *
 * @param limit Maximum tokens to return (default: 20)
 * @returns Normalized MemeAlphaToken[] array
 */
export async function discoverTokens(limit: number = 20): Promise<MemeAlphaToken[]> {
  logger.info(`nansen discovering tokens (limit=${limit})`, 'meme-nansen')

  if (!getNansenApiKey()) {
    logger.warn('nansen discovery skipped: MOBY_NANSEN_API_KEY not configured', 'meme-nansen')
    return []
  }

  try {
    // Smart Money filter with 24h timeframe
    const payload = {
      chains: ['ethereum', 'solana', 'base', 'arb', 'bnb'] as const,
      timeframe: '24h',
      filters: {
        trader_type: 'sm',
        include_native_tokens: false,
        include_stablecoins: false,
        nof_traders: { min: 10 },
        volume: { min: 50000 }, // $50k minimum volume
      },
      order_by: [{ field: 'volume', direction: 'DESC' }],
      pagination: {
        page: 1,
        per_page: limit,
      },
    }

    const rawData = await fetchNansen<NansenTokenScreenerResponse>(
      '/api/v1/token-screener',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    )

    // Validate response structure
    const validated = NansenScreenerResponseSchema.safeParse(rawData)
    if (!validated.success) {
      logger.error('nansen validation failed', 'meme-nansen', {
        errors: validated.error.issues,
      })
      return []
    }

    // Normalize to MemeAlphaToken shape
    const tokens: MemeAlphaToken[] = validated.data.data.map((token) => {
      // Map netflow to riskLevel (conservative heuristic)
      const riskLevel = token.netflow && token.netflow > 0 ? 1 : 0
      
      return {
        id: `${token.chain}:${token.token_address}`,
        platform: 'nansen',
        chain: token.chain,
        contract: token.token_address,
        symbol: token.token_symbol.toUpperCase(),
        name: token.token_symbol.toUpperCase(), // Fall back to symbol
        price: token.price_usd ?? 0,
        change24h: token.price_change ?? 0,
        volume24h: token.volume ?? token.buy_volume ?? 0,
        marketCap: token.market_cap_usd ?? 0,
        liquidity: token.liquidity ?? 0,
        createdAt: token.token_deployment_date
          ? new Date(token.token_deployment_date).getTime()
          : null,
        holders: token.nof_traders ?? 0,
        top10HolderPercent: 0, // Not available in standard screener response
        social: {},
        audited: false, // audit must be called separately
        buyCount24h: undefined,
        sellCount24h: undefined,
        riskLevel,
      }
    })

    logger.debug(`nansen discovery completed: ${tokens.length} tokens`, 'meme-nansen', {
      tokens: tokens.map((t) => `${t.symbol}@${t.chain}`),
    })

    return tokens
  } catch (e) {
    logger.error('nansen discovery failed', 'meme-nansen', {
      error: e instanceof Error ? e.message : String(e),
    })
    return []
  }
}

// ───────────────────── AUDIT ENDPOINT ─────────────────────────

/**
 * Audit a token contract for risk factors using Nansen analytics.
 * Note: Specific contract risk endpoints depend on subscription tier.
 * This implements a generic pattern; adjust path when tier-specific docs found.
 *
 * @param chain Blockchain identifier (e.g., 'ethereum', 'solana')
 * @param contract Contract address
 * @returns MemeRiskAudit or null if not found/no data
 */
export async function auditToken(
  chain: string,
  contract: string
): Promise<MemeRiskAudit | null> {
  logger.info(`nansen auditing token ${contract} on ${chain}`, 'meme-nansen')

  if (!getNansenApiKey()) {
    logger.warn('nansen audit skipped: MOBY_NANSEN_API_KEY not configured', 'meme-nansen')
    return null
  }

  try {
    // NOTE: Contract risk endpoints vary by Nansen product (Contract Analytics, Token Auditor, etc.)
    // Attempt common patterns; adjust once tier-specific endpoints confirmed
    const endpoints = [
      `/analyzer/contract?address=${contract}&chain=${chain}`,
      `/token-auditor/${chain}/${contract}`,
    ]

    let riskData: NansenContractAnalyticsResponse | null = null

    for (const endpoint of endpoints) {
      try {
        const result = await fetchNansen(endpoint)
        // Try to parse as known schema; might need adjustment per Nansen product
        if (result && typeof result === 'object') {
          riskData = result as NansenContractAnalyticsResponse
          break
        }
      } catch (e) {
        // Endpoint not available at this tier; try next
        logger.debug(`nansen audit endpoint ${endpoint.split('/').slice(-3).join('/')} not found`, 'meme-nansen', {
          chain,
          contract,
        })
      }
    }

    if (!riskData || !riskData.risk_metrics) {
      logger.warn('nansen audit: no risk data returned', 'meme-nansen', { chain, contract })
      return null
    }

    const metrics = riskData.risk_metrics

    // Map Nansen risk scores (0-10) → MemeRiskAudit (0-3 scale, higher riskier)
    const riskLevelRaw = metrics.overall_risk_score ?? 5
    const riskLevel = Math.min(3, Math.floor(riskLevelRaw / 3)) // 0-10 → 0-3
    const riskLabel = (['safe', 'middle', 'middle', 'high'][riskLevel] || 'unknown') as MemeRiskAudit['riskLabel']

    const audit: MemeRiskAudit = {
      id: `nansen:${chain}:${contract}`,
      platform: 'nansen',
      chain,
      contract,
      symbol: '', // Symbol not available in standard contract analyzer
      name: '', // Name not available in standard contract analyzer
      riskLevel,
      riskLabel,
      buyTax: 0,
      sellTax: 0,
      top10HolderPercent: metrics.top_10_holder_pct ?? 0,
      lpLockedPercent: metrics.lp_locked_pct ?? -1,
      canFreeze: metrics.can_freeze ?? false,
      canMint: metrics.can_mint ?? false,
      isHoneypot: false, // not reported by this source
      riskCounts: {
        high: Math.max(0, Math.floor(metrics.honeypot_risk / 7)),
        middle: Math.max(0, Math.floor(metrics.liquidity_risk / 4)),
        low: Math.max(0, metrics.contract_auth_risk),
      },
      auditedAt: Date.now(),
    }

    logger.info(`nansen audit complete: ${audit.riskLabel} risk (${contract})`, 'meme-nansen', {
      riskLevel: audit.riskLevel,
      metricBreakdown: {
        honeypot: metrics.honeypot_risk,
        liquidity: metrics.liquidity_risk,
        concentration: metrics.holder_concentration_risk,
      },
    })

    return audit
  } catch (e) {
    logger.error('nansen audit failed', 'meme-nansen', {
      chain,
      contract,
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

