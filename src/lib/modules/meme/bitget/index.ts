// ─────────────────────────────────────────────────────────────
// Module: Bitget Wallet — Meme Alpha (new-token discovery + honeypot audit)
// sourceType: public-api
// upstreamProduct: Bitget Wallet Token Markets / token security audit
// endpoint: https://bopenapi.bgwapi.io/bgw-pro/market/v3  (POST, HMAC-SHA256 signed)
// discoveredVia: docs
// lastVerified: 2026-08-28
// Auth: REQUIRED. Market endpoints require x-api-key + x-api-timestamp +
//   x-api-signature (HMAC-SHA256 over sorted JSON content, base64 encoded).
//   No public/unauthenticated access exists. Apply at https://portal-webbitget.com.
//   Set BITGET_WALLET_API_KEY + BITGET_WALLET_SECRET_KEY env to enable.
//   Without credentials the module throws — route error-isolates it.
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto'

import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'


const BITGET_BASE = 'https://bopenapi.bgwapi.io/bgw-pro/market/v3'

// Chain ids Bitget Wallet uses for meme tokens (BSC / ETH / Base / Solana).
const DISCOVERY_CHAINS = ['BSC', 'ETH', 'BASE', 'SOL']

const API_KEY = process.env.BITGET_WALLET_API_KEY ?? ''
const API_SECRET = process.env.BITGET_WALLET_SECRET_KEY ?? ''

function bitgetKey(): string {
  if (!API_KEY) throw new Error('BITGET_WALLET_API_KEY not set')
  if (!API_SECRET) throw new Error('BITGET_WALLET_SECRET_KEY not set')
  return API_KEY
}

function bitgetSecret(): string {
  if (!API_SECRET) throw new Error('BITGET_WALLET_SECRET_KEY not set')
  return API_SECRET
}

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

// ── Signing ────────────────────────────────────────────────────
// Verified against official Bitget Wallet auth docs (web3.bitget.com/en/docs/authentication):
//   content = sorted JSON { apiPath, body, x-api-key, x-api-timestamp, <query params> }
//   signature = base64(HMAC-SHA256(secret, content))

function signRequest(path: string, bodyStr: string, queryParams: Record<string, string> = {}): {
  headers: Record<string, string>
} {
  const ts = String(Date.now())
  const content: Record<string, string> = {
    apiPath: path,
    body: bodyStr,
    'x-api-key': bitgetKey(),
    'x-api-timestamp': ts,
    ...queryParams,
  }
  // Sort keys alphabetically (matches Go SDK json.Marshal behavior)
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(content).sort()) {
    sorted[key] = content[key]
  }
  const contentStr = JSON.stringify(sorted)
  const signature = crypto
    .createHmac('sha256', bitgetSecret())
    .update(contentStr, 'utf8')
    .digest('base64')
  return {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': bitgetKey(),
      'x-api-timestamp': ts,
      'x-api-signature': signature,
      'x-locale': 'en_US',
    },
  }
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

async function bitgetPost<T>(
  path: string,
  body: Record<string, unknown>,
  queryParams: Record<string, string> = {},
): Promise<T> {
  const bodyStr = JSON.stringify(body)
  const { headers } = signRequest(path, bodyStr, queryParams)
  const qs = new URLSearchParams(queryParams).toString()
  const url = `${BITGET_BASE}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyStr,
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
