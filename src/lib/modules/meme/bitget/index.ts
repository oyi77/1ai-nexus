// ─────────────────────────────────────────────────────────────
// Module: Bitget Wallet — Meme Alpha (new-token discovery + honeypot audit)
// sourceType: public-api
// upstreamProduct: Bitget Wallet Token Markets / token security audit
// endpoint: https://copenapi.bgwapi.io/market/v3  (POST, SHA256 hash signed)
// discoveredVia: bitget-wallet-mcp server source (github.com/bitget-wallet-ai-lab/bitget-wallet-mcp)
// lastVerified: 2026-08-28
// Auth: NO API key required. Uses SHA256 hash signing with a static
//   "toc_agent" token. Signature = SHA256(Method + Path + Body + Timestamp),
//   hex-encoded with "0x" prefix. Headers: channel/brand/clientversion/language
//   all set to "toc_agent", token = "toc_agent", X-SIGN + X-TIMESTAMP.
// Transport: native https.request (Cloudflare TLS fingerprinting blocks fetch).
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import https from 'node:https'
import crypto from 'node:crypto'
import { TTL } from '../../types'
import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'

const MODULE_ID = 'bitget-meme'
const BITGET_TTL = TTL.TOKEN_DATA * 3 // 60s × 3 = 180s
const BITGET_HOST = 'copenapi.bgwapi.io'

// Chain ids Bitget Wallet uses for meme tokens (BSC / ETH / Base / Solana).
const DISCOVERY_CHAINS = ['BSC', 'ETH', 'BASE', 'SOL']

// ── Signing ────────────────────────────────────────────────────
// Verified against the canonical bitget-wallet-mcp server source
// (github.com/bitget-wallet-ai-lab/bitget-wallet-mcp/blob/main/server.py).
// No API key required — SHA256 hash signing with static "toc_agent" token.

function signRequest(method: string, path: string, bodyStr: string, ts: string): string {
  const message = method + path + bodyStr + ts
  return '0x' + crypto.createHash('sha256').update(message, 'utf8').digest('hex')
}

function buildHeaders(method: string, path: string, bodyStr: string): Record<string, string> {
  const ts = String(Date.now())
  const sign = signRequest(method, path, bodyStr, ts)
  return {
    'Content-Type': 'application/json',
    channel: 'toc_agent',
    brand: 'toc_agent',
    clientversion: '10.0.0',
    language: 'en',
    token: 'toc_agent',
    'X-SIGN': sign,
    'X-TIMESTAMP': ts,
  }
}

// ── Raw payload shapes (Bitget Wallet Markets API) ──────────────

interface BitgetTopRankItem {
  symbol?: string
  name?: string
  chain?: string
  contract?: string
  risk_level?: string
  icon?: string
  price?: number | string
  change_24h?: number | string
  volume_24h?: number | string
  turnover_24h?: number | string
  market_cap?: number | string
  issue_date?: number | string
  holders?: number
  top10_holder_percent?: number | string
}

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
  dev_rug_percent?: number | string
  lock_lp_percent?: number | string
  twitter?: string
  website?: string
  telegram?: string
  issue_date?: number | string
  decimals?: number
  total_supply?: number | string
  circulating_supply?: number | string
  icon?: string
}

interface BitgetRiskCheck {
  labelName?: string
  status?: number
  priority?: number
  type?: number
}

interface BitgetAuditResult {
  chain?: string
  chain_id?: number
  contract?: string
  riskChecks?: BitgetRiskCheck[]
  warnChecks?: BitgetRiskCheck[]
  lowChecks?: BitgetRiskCheck[]
}

// ── Normalizers ────────────────────────────────────────────────

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function bitgetRiskLevelToNumber(riskLevel: string): number {
  const map: Record<string, number> = { high: 3, medium: 2, middle: 2, low: 1 }
  return map[riskLevel?.toLowerCase()] ?? 0
}

// ── HTTP ───────────────────────────────────────────────────────
// Uses native https.request because Cloudflare TLS fingerprinting
// blocks Node.js fetch (undici) with a 403.

async function bitgetPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const bodyStr = JSON.stringify(body)
  const headers = buildHeaders('POST', path, bodyStr)
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: BITGET_HOST,
        path: path,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Bitget ${res.statusCode}: ${path}`))
          } else {
            resolve(JSON.parse(data) as T)
          }
        })
      },
    )
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

// ── Discovery ──────────────────────────────────────────────────

/** New-token discovery: topRank by hotpicks across chains. */
export async function discoverBitgetTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  for (const chain of DISCOVERY_CHAINS) {
    const raw = await bitgetPost<{
      data?: { list?: BitgetTopRankItem[] }
    }>('/market/v3/topRank/detail', {
      name: 'hotpicks',
      chain,
      limit: limitPerChain,
    })
    const list = raw.data?.list ?? []
    for (const item of list) {
      if (!item.contract) continue
      const cChain = item.chain ?? chain
      const contract = item.contract
      out.push({
        id: `${cChain}:${contract}`,
        platform: 'bitget' as MemePlatform,
        chain: cChain,
        contract,
        symbol: item.symbol ?? '',
        name: item.name ?? item.symbol ?? '',
        price: toNum(item.price),
        change24h: toNum(item.change_24h),
        volume24h: toNum(item.volume_24h),
        marketCap: toNum(item.market_cap),
        liquidity: 0,
        createdAt: item.issue_date ? toNum(item.issue_date) : null,
        riskLevel: bitgetRiskLevelToNumber(item.risk_level ?? ''),
        holders: toNum(item.holders),
        top10HolderPercent: toNum(item.top10_holder_percent),
        social: {},
        audited: false,
      })
    }
  }
  return out
}

// ── Risk audit ─────────────────────────────────────────────────

export async function auditBitgetToken(chain: string, contract: string): Promise<MemeRiskAudit | null> {
  const raw = await bitgetPost<{
    data?: BitgetAuditResult[]
  }>('/market/v3/coin/security/audits', {
    list: [{ chain, contract }],
    source: 'bg',
  })
  const list = raw.data
  if (!list || list.length === 0) return null
  const audit = list[0]

  const high = (audit.riskChecks ?? []).filter((c) => c.status === 1).length
  const mid = (audit.warnChecks ?? []).filter((c) => c.status === 1).length
  const low = (audit.lowChecks ?? []).filter((c) => c.status === 1).length
  const riskLevel = Math.min(3, high + (mid > 0 ? 1 : 0))
  const label: MemeRiskAudit['riskLabel'] =
    riskLevel >= 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'

  return {
    id: `${chain}:${contract}`,
    platform: 'bitget',
    chain,
    contract,
    symbol: '',
    name: '',
    riskLevel,
    riskLabel: label,
    buyTax: 0, // TODO: extract from riskChecks when semantics confirmed
    sellTax: 0,
    top10HolderPercent: 0,
    lpLockedPercent: -1,
    canFreeze: false,
    canMint: false,
    riskCounts: { high, middle: mid, low },
    auditedAt: Date.now(),
  }
}

/** Fetch one token's security/holder profile (honeypot audit source). */
export async function getBitgetBaseInfo(
  chain: string,
  contract: string,
): Promise<MemeRiskAudit | MemeAlphaToken | null> {
  const raw = await bitgetPost<{
    data?: { list?: BitgetBaseInfo[] }
  }>('/market/v3/coin/batchGetBaseInfo', {
    list: [{ chain, contract }],
  })
  const list = raw.data?.list
  if (!list || list.length === 0) return null
  const d = list[0]
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
    createdAt: d.issue_date ? toNum(d.issue_date) : null,
    riskLevel: 0,
    holders: toNum(d.holders),
    top10HolderPercent: toNum(d.top10_holder_percent, toNum(d.insider_holder_percent)),
    social: {
      twitter: d.twitter,
      telegram: d.telegram,
      site: d.website,
    },
    audited: true,
  }
}
