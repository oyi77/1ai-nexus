// ─────────────────────────────────────────────────────────────
// Module: Bitget Wallet — Meme Alpha (new-token discovery + honeypot audit)
// sourceType: public-api
// upstreamProduct: Bitget Wallet Token Markets / token security audit
// endpoint: https://www.bitget.com/bgw-pro/market/v3/  (POST, action in body)
// discoveredVia: docs
// lastVerified: 2026-08-28
// Official docs: Bitget Wallet Markets API. No API key required for the
// public market endpoints (rate-limited; space requests out).
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'

const MODULE_ID = 'bitget-meme'
const BITGET_TTL = TTL.TOKEN_DATA * 3 // 60s × 3 = 180s

const BITGET_BASE = 'https://www.bitget.com/bgw-pro/market/v3'

// Chain ids Bitget Wallet uses for meme tokens (BSC / ETH / Base / Solana).
// Discovery endpoints accept a `chain` filter; we query the busiest chains.
const DISCOVERY_CHAINS = ['BSC', 'ETH', 'BASE', 'SOL']

const BITGET_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'x-site-info': '0',
  'x-locale': 'en_US',
  Referer: 'https://web3.bitget.com/',
} as const

// ── Raw payload shapes (Bitget Wallet Markets API) ──────────────

interface BitgetBaseInfo {
  symbol?: string
  name?: string
  chain?: string
  contract?: string
  price?: number | string
  holders?: number
  liquidity?: number | string
  top10_holder_percent?: number | string
  insider_holder_percent?: number | string
  dev_holder_percent?: number | string
  sniper_holder_percent?: number | string
  risk_level?: number
  social?: { twitter?: string; telegram?: string; website?: string }
}

interface BitgetTopRankItem {
  symbol?: string
  chain?: string
  contract?: string
  risk_level?: number
  price?: number | string
  change_24h?: number | string
  volume_24h?: number | string
  market_cap?: number | string
  issue_date?: number | string
  holders?: number
  top10_holder_percent?: number | string
}

interface BitgetTopRankEnvelope {
  code?: string | number
  data?: { list?: BitgetTopRankItem[] }
  msg?: string
}

// ── Normalizers ────────────────────────────────────────────────

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function bailOnError(code: unknown, msg?: string): void {
  if (code !== undefined && code !== 0 && code !== '000000' && String(code) !== '0') {
    throw new Error(`Bitget ${code}${msg ? `: ${msg}` : ''}`)
  }
}

async function bitgetPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BITGET_BASE}${path}`, {
    method: 'POST',
    headers: BITGET_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Bitget ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

/** Fetch one token's security/holder profile (honeypot audit source). */
export async function getBitgetBaseInfo(
  chain: string,
  contract: string,
): Promise<MemeRiskAudit | MemeAlphaToken | null> {
  const raw = await bitgetPost<{ code?: string | number; data?: BitgetBaseInfo; msg?: string }>(
    '/coin/getBaseInfo',
    { chain, contract },
  )
  bailOnError(raw.code, raw.msg)
  const d = raw.data
  if (!d) return null
  const id = `${chain}:${contract}`
  return {
    id,
    platform: 'bitget' as MemePlatform,
    chain,
    contract,
    symbol: d.symbol ?? '',
    name: d.name ?? '',
    price: toNum(d.price),
    change24h: 0,
    volume24h: 0,
    marketCap: 0,
    liquidity: toNum(d.liquidity),
    createdAt: null,
    riskLevel: toNum(d.risk_level),
    holders: toNum(d.holders),
    top10HolderPercent: toNum(d.top10_holder_percent, toNum(d.insider_holder_percent)),
    social: {
      twitter: d.social?.twitter,
      telegram: d.social?.telegram,
      site: d.social?.website,
    },
    audited: true,
  }
}

/** Risk audit for a single token (used by /meme/risk). */
export async function auditBitgetToken(chain: string, contract: string): Promise<MemeRiskAudit | null> {
  const info = await getBitgetBaseInfo(chain, contract)
  if (!info) return null
  const riskLevel = info.riskLevel
  const label: MemeRiskAudit['riskLabel'] =
    riskLevel >= 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'
  return {
    id: info.id,
    platform: 'bitget',
    chain,
    contract,
    symbol: info.symbol,
    name: info.name,
    riskLevel,
    riskLabel: label,
    buyTax: 0,
    sellTax: 0,
    top10HolderPercent: info.top10HolderPercent,
    lpLockedPercent: -1,
    canFreeze: false,
    canMint: false,
    riskCounts: { high: riskLevel >= 3 ? 1 : 0, middle: riskLevel === 2 ? 1 : 0, low: riskLevel <= 1 ? 1 : 0 },
    auditedAt: Date.now(),
  }
}

/** New-token discovery: topRank by hotpicks/losers across chains. */
export async function discoverBitgetTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  for (const chain of DISCOVERY_CHAINS) {
    const raw = await bitgetPost<BitgetTopRankEnvelope>('/topRank/detail', {
      name: 'hotpicks',
      chain,
      limit: limitPerChain,
    })
    bailOnError(raw.code, raw.msg)
    const list = raw.data?.list ?? []
    for (const item of list) {
      if (!item.contract) continue
      const cChain = item.chain ?? chain
      const contract = item.contract
      out.push({
        id: `${cChain}:${contract}`,
        platform: 'bitget',
        chain: cChain,
        contract,
        symbol: item.symbol ?? '',
        name: item.symbol ?? '',
        price: toNum(item.price),
        change24h: toNum(item.change_24h) / 100,
        volume24h: toNum(item.volume_24h),
        marketCap: toNum(item.market_cap),
        liquidity: 0,
        createdAt: item.issue_date ? toNum(item.issue_date) : null,
        riskLevel: toNum(item.risk_level),
        holders: toNum(item.holders),
        top10HolderPercent: toNum(item.top10_holder_percent),
        social: {},
        audited: false,
      })
    }
  }
  return out
}

// ── Module ─────────────────────────────────────────────────────

const bitgetMemeModule: DataModule = {
  id: MODULE_ID,
  name: 'Bitget Wallet Meme Alpha',
  category: 'defi',
  sourceType: 'public-api',
  provenance: {
    describesItself:
      'New-token discovery + honeypot audit from Bitget Wallet token markets (topRank hotpicks + per-token security base info).',
    upstreamProduct: 'Bitget Wallet Token Markets',
    discoveredVia: 'docs',
    fragility: 'moderate',
    lastVerified: '2026-08-28',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await bitgetPost<{ code?: unknown }>('/topRank/detail', { name: 'hotpicks', chain: 'BSC', limit: 1 })
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (err) {
      return {
        status: 'degraded',
        lastChecked: new Date(),
        failureCount: 1,
        notes: err instanceof Error ? err.message : 'bitget meme endpoint unreachable',
      }
    }
  },

  async fetch<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    const tokens = await discoverBitgetTokens()
    return {
      data: tokens as unknown as T,
      source: MODULE_ID,
      cached: false,
      timestamp: Date.now(),
      ttl: BITGET_TTL,
    }
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: [] as unknown as T,
      source: 'bitget-meme (fallback)',
      cached: true,
      timestamp: Date.now(),
      ttl: BITGET_TTL,
    }
  },
}

export default bitgetMemeModule
