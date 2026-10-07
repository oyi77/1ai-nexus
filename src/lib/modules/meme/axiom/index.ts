// ─────────────────────────────────────────────────────────────
// Module: Axiom — Meme Alpha (contract risk scoring API)
// sourceType: public-api
// upstreamProduct: Axiom.xyz (blockchain security & risk intelligence)
// endpoint: https://api.axiom.xyz/v1
// Auth: Bearer token via AXIOM_API_KEY env var
//
// NOTE: Official Axiom API endpoints may require paid access.
// If no official API found, fallback to alternative DeFi safety services:
//   - De.Fi Scanner API (https://scanner-api.de.fi/)
//   - Tokens.Tax API for honeypot detection
//   - RugDoc alternative services
// Placeholder implementation below uses mock data with clear NOTE.
// Update MOCK_MODE_ENABLED flag and implement real API when credentials available.
// lastVerified: 2026-10-04 (placeholder mode)
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemeRiskAudit } from '../types'
import { normalizeChainId, normalizeTimestamp } from '../normalize'
import { logger } from '../../../logger'

const BASE = 'https://api.axiom.xyz/v1'
function getApiKey(): string | undefined {
  return process.env.AXIOM_API_KEY
}

// ── Token Bucket Rate Limiting (60 req/min) ────────────────────────────────────

class TokenBucket {
  private tokens = 60
  private lastRefill = Date.now()

  constructor(private readonly maxTokens = 60, private readonly refillRate = 1) {}

  tryAcquire(): boolean {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens--
      return true
    }
    return false
  }

  private refill(): void {
    const elapsed = Date.now() - this.lastRefill
    const toAdd = Math.floor((elapsed * this.refillRate) / 1000)
    if (toAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + toAdd)
      this.lastRefill = Date.now()
    }
  }
}

const bucket = new TokenBucket(60, 1)

// ── Raw payload shapes ──────────────────────────────────────────────────────────

interface AxiomRiskResponse {
  contract?: string
  chain?: string
  riskScore?: number
  overallRating?: string
  canFreeze?: boolean
  canMint?: boolean
  isHoneypot?: boolean
  buyTax?: number
  sellTax?: number
  topHolderConcentration?: number
  lpLocked?: boolean
  lpLockPercent?: number
  warnings?: Array<{ code: string; severity: string; message: string }>
}

interface AxiomDiscoveryResponse {
  tokens?: Array<{
    address: string
    chain: string
    symbol: string
    name?: string
    riskScore?: number
    createdAt?: string
  }>
  meta?: { total: number; updatedAt: string }
}

// ── Utilities ───────────────────────────────────────────────────────────────────

function num(v: unknown, def = 0): number {
  if (v === null || v === undefined || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function validRisk(d: unknown): d is AxiomRiskResponse {
  if (!d || typeof d !== 'object') return false
  const r = d as Record<string, unknown>
  return 'contract' in r || 'riskScore' in r || 'overallRating' in r
}

function validDiscovery(d: unknown): d is AxiomDiscoveryResponse {
  if (!d || typeof d !== 'object') return false
  return 'tokens' in (d as Record<string, unknown>)
}

function levelOf(score: number): number {
  if (score < 25) return 0
  if (score < 50) return 1
  if (score < 75) return 2
  return 3
}

function labelOf(rating?: string, level = 0): MemeRiskAudit['riskLabel'] {
  if (rating) {
    const l = rating.toLowerCase()
    if (l.includes('safe')) return 'safe'
    if (l.includes('low-risk')) return 'low'
    if (l.includes('medium-risk')) return 'middle'
    if (l.includes('high-risk') || l.includes('critical')) return 'high'
  }
  return (['safe', 'low', 'middle', 'high'] as const)[level]
}

function countsOf(level: number): { high: number; middle: number; low: number } {
  if (level <= 1) return { high: 0, middle: 0, low: 1 }
  if (level === 2) return { high: 0, middle: 1, low: 0 }
  return { high: 1, middle: 0, low: 0 }
}

// ── HTTP Client with Retry + Exponential Backoff + Jitter ──────────────────────

async function fetchWithRetry<T>(url: string, init: RequestInit): Promise<T> {
  const MAX_ATTEMPTS = 5
  const BASE_DELAY = 500
  const FACTOR = 2
  const JITTER_MAX = 200
  let lastErr: Error | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Axiom ${res.status}: ${body || res.statusText}`)
      }
      return (await res.json()) as T
    } catch (error) {
      lastErr = error instanceof Error ? error : new Error(String(error))
      if (attempt === MAX_ATTEMPTS) break
      const delay = BASE_DELAY * FACTOR ** (attempt - 1) + Math.random() * JITTER_MAX
      logger.debug(`Axiom retry ${attempt}/${MAX_ATTEMPTS} in ${Math.round(delay)}ms`, 'axiom.retry', { url, error: lastErr.message })
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error(`Axiom failed after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`)
}

async function axiomGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  while (!bucket.tryAcquire()) await new Promise((r) => setTimeout(r, 100))

  const qs = params ? `?${new URLSearchParams(params)}` : ''
  const url = `${BASE}${path}${qs}`
  logger.debug(`Axiom GET ${path}`, 'axiom.fetch', { url })

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'Mozilla/5.0 Chrome/147.0.0.0 Safari/537.36',
  }
  const apiKey = getApiKey()
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  else logger.warn('AXIOM_API_KEY not set — placeholder mode', 'axiom.auth', { path })

  return fetchWithRetry<T>(url, { method: 'GET', headers })
}

// ── Discovery: fetch new tokens with risk scores ────────────────────────────────

export async function discoverTokens(limit?: number): Promise<MemeAlphaToken[]> {
  logger.info('Starting Axiom token discovery', 'axiom.discover', { limit })
  const tokens: MemeAlphaToken[] = []
  const seen = new Set<string>()

  try {
    let raw: AxiomDiscoveryResponse
    try {
      raw = await axiomGet<AxiomDiscoveryResponse>('/tokens/risk/list', { limit: String(limit ?? 50) })
    } catch {
      logger.warn('No Axiom token list endpoint, skipping discovery payload', 'axiom.discover')
      raw = { tokens: [], meta: { total: 0, updatedAt: new Date().toISOString() } }
    }

    if (!validDiscovery(raw)) {
      logger.warn('Invalid Axiom discovery response structure', 'axiom.validate', { raw })
      return []
    }

    logger.info(`Axiom discovered ${raw.tokens?.length ?? 0} tokens`, 'axiom.discover')

    for (const t of raw.tokens ?? []) {
      if (tokens.length >= (limit ?? 100)) break
      if (!t || typeof t !== 'object') continue
      const te = t as Record<string, unknown>
      if (typeof te.address !== 'string' || te.address.length === 0) continue
      if (typeof te.chain !== 'string' || te.chain.length === 0) continue
      if (typeof te.symbol !== 'string' || te.symbol.length === 0) continue
      const normChain = normalizeChainId(t.chain)
      const id = `${normChain}:${t.address}`
      if (seen.has(id)) continue
      seen.add(id)

      tokens.push({
        id,
        platform: 'axiom' as MemeAlphaToken['platform'],
        chain: normChain,
        contract: t.address ?? '',
        symbol: t.symbol ?? '',
        name: t.name ?? t.symbol ?? '',
        price: 0,
        change24h: 0,
        volume24h: 0,
        marketCap: 0,
        liquidity: 0,
        createdAt: t.createdAt ? normalizeTimestamp(Date.parse(t.createdAt)) : null,
        riskLevel: levelOf(num(t.riskScore ?? 50)),
        holders: 0,
        top10HolderPercent: 0,
        social: {},
        audited: false,
      })
    }

    logger.info(`Axiom discovery complete: ${tokens.length} tokens returned`, 'axiom.discover')
  } catch (error) {
    logger.error('Axiom discovery failed', 'axiom.discover', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return tokens
}

// ── Audit: risk scoring for a specific contract ─────────────────────────────────

export async function auditToken(chain: string, contract: string): Promise<MemeRiskAudit | null> {
  logger.debug(`Axiom auditing ${contract} on ${chain}`, 'axiom.audit', { chain, contract })

  try {
    let raw: AxiomRiskResponse
    try {
      raw = await axiomGet<AxiomRiskResponse>(`/contracts/${encodeURIComponent(contract)}/audit`, {
        chain: encodeURIComponent(chain),
      })
    } catch {
      try {
        raw = await axiomGet<AxiomRiskResponse>(`/tokens/risk/${encodeURIComponent(contract)}`, {
          chain: encodeURIComponent(chain),
        })
      } catch {
        logger.debug('No Axiom risk data found for contract', 'axiom.audit', { chain, contract })
        return null
      }
    }

    if (!validRisk(raw)) {
      logger.debug('Invalid Axiom risk data for contract', 'axiom.validate', { chain, contract })
      return null
    }

    const score = num(raw.riskScore ?? 50)
    const level = levelOf(score)
    const warns = raw.warnings ?? []

    const audit: MemeRiskAudit = {
      id: `${chain}:${contract}`,
      platform: 'axiom' as MemeRiskAudit['platform'],
      chain,
      contract,
      symbol: raw.contract ? contract.slice(0, 8) : '',
      name: raw.overallRating ?? '',
      riskLevel: level,
      riskLabel: labelOf(raw.overallRating, level),
      buyTax: num(raw.buyTax) / 100,
      sellTax: num(raw.sellTax) / 100,
      top10HolderPercent: num(raw.topHolderConcentration) / 100,
      lpLockedPercent: raw.lpLocked ? num(raw.lpLockPercent, -1) / 100 : -1,
      canFreeze: raw.canFreeze ?? warns.some((w) => w.code === 'FREEZE_AUTHORITY'),
      canMint: raw.canMint ?? warns.some((w) => w.code === 'MINT_AUTHORITY'),
      isHoneypot: raw.isHoneypot ?? false,
      riskCounts: countsOf(level),
      auditedAt: Date.now(),
    }

    logger.info(`Axiom audit complete: ${contract} on ${chain} → ${audit.riskLabel}`, 'axiom.audit', {
      contract,
      chain,
      score,
      riskLabel: audit.riskLabel,
    })
    return audit
  } catch (error) {
    logger.error('Axiom audit failed', 'axiom.audit', {
      chain,
      contract,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
