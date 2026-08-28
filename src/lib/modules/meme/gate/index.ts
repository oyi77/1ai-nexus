// ─────────────────────────────────────────────────────────────
// Module: Gate.io DEX — Meme Alpha (new-token discovery + honeypot audit)
// sourceType: public-api
// upstreamProduct: Gate.io Web3 OpenAPI (DEX token endpoints)
// endpoint: https://openapi.gateweb3.cc/api/v1/dex  (POST, HMAC-SHA256 signed)
// discoveredVia: docs
// lastVerified: 2026-08-28
// Signing (verified against gate-skills canonical script + live probe):
//   prehash = timestamp + "/api/v1/dex" + compact_body
//   signature = base64(HMAC-SHA256(sk, prehash))
//   headers: X-API-Key, X-Timestamp, X-Signature, X-Request-Id
// Auth: public default AK/SK (Basic tier 2 QPS). Override via
//   GATE_DEX_API_KEY / GATE_DEX_SECRET_KEY env for higher quota.
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto'

import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'


const GATE_HOST = 'https://openapi.gateweb3.cc'
const GATE_PATH = '/api/v1/dex'

const API_KEY = process.env.GATE_DEX_API_KEY ?? '7RAYBKMG5MNMKK7LN6YGCO5UDI'
const SECRET_KEY =
  process.env.GATE_DEX_SECRET_KEY ?? 'COnwcshYA3EK4BjBWWrvwAqUXrvxgo0wGNvmoHk7rl4.6YLniz4h'

// Gate Web3 chain ids for meme discovery (BSC / ETH / Base / Solana).
const DISCOVERY_CHAIN_IDS = [56, 1, 8453, 501]

interface GateRawToken {
  chain?: string
  address?: string
  name?: string
  symbol?: string
  liquidity?: number | string
  holder_count?: number
  created_at?: string
  trend_info?: {
    price_change_24h?: number | string
    volume_24h?: number | string
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface GateRangeResponse {
  code?: string | number
  msg?: string
  message?: string
  data?: {
    tokens?: GateRawToken[]
    count?: number
    next_cursor?: string
  }
}

interface GateRiskItem {
  risk_name?: string
  risk_key?: string
  risk_level?: number
  risk_flag?: string
  risk_value?: string
  [key: string]: unknown
}

interface GateRiskInfo {
  chain?: string
  address?: string
  high_risk_num?: number
  middle_risk_num?: number
  low_risk_num?: number
  highest_risk_level?: number
  all_analysis?: {
    high_risk_list?: GateRiskItem[]
    middle_risk_list?: GateRiskItem[]
    low_risk_list?: GateRiskItem[]
  }
  [key: string]: unknown
}

interface GateRiskResponse {
  code?: string | number
  msg?: string
  message?: string
  data?: GateRiskInfo
}

// ── Signing ────────────────────────────────────────────────────
// Verified against the canonical gate-skills script (gate-api-call.py)
// and a live probe that returned real BSC token data.

function buildGateHeaders(bodyStr: string): Record<string, string> {
  const ts = String(Date.now())
  const requestId = crypto.randomUUID()
  const prehash = `${ts}${GATE_PATH}${bodyStr}`
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(prehash, 'utf8')
    .digest('base64')
  return {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
    'X-Timestamp': ts,
    'X-Signature': signature,
    'X-Request-Id': requestId,
  }
}

async function gateDex<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({ action, params })
  const res = await fetch(`${GATE_HOST}${GATE_PATH}`, {
    method: 'POST',
    headers: buildGateHeaders(body),
    body,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Gate ${res.status}: ${action}`)
  return res.json() as Promise<T>
}

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Discovery ──────────────────────────────────────────────────

export async function discoverGateTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  const now = Date.now()
  const start = new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString()
  const end = new Date(now).toISOString()
  for (const chainId of DISCOVERY_CHAIN_IDS) {
    const raw = await gateDex<GateRangeResponse>('base.token.range_by_created_at', {
      start,
      end,
      chain_id: String(chainId),
      limit: String(limitPerChain),
    })
    if (raw.code !== undefined && raw.code !== 0 && String(raw.code) !== '0') {
      throw new Error(`Gate range_by_created_at ${raw.code}: ${raw.msg ?? raw.message ?? ''}`)
    }
    const list = raw.data?.tokens ?? []
    for (const t of list) {
      if (!t.address) continue
      out.push({
        id: `${t.chain ?? chainId}:${t.address}`,
        platform: 'gate' as MemePlatform,
        chain: t.chain ?? String(chainId),
        contract: t.address,
        symbol: t.symbol ?? '',
        name: t.name ?? '',
        price: 0, // discovery response exposes no spot price
        change24h: toNum(t.trend_info?.price_change_24h), // ratio, not percentage
        volume24h: toNum(t.trend_info?.volume_24h),
        marketCap: 0, // discovery response exposes no market cap
        liquidity: toNum(t.liquidity),
        createdAt: t.created_at ? Date.parse(t.created_at) || null : null,
        riskLevel: 0, // discovery response exposes no per-token risk level
        holders: toNum(t.holder_count),
        top10HolderPercent: 0,
        social: {},
        audited: false,
      })
    }
  }
  return out
}

// ── Risk audit ─────────────────────────────────────────────────

function riskFlag(list: GateRiskItem[] | undefined, key: string): string {
  if (!list) return '0'
  return list.find((r) => r.risk_key === key)?.risk_flag ?? '0'
}

const GATE_CHAIN_ID: Record<string, number> = {
  eth: 1,
  ethereum: 1,
  bsc: 56,
  binance: 56,
  base: 8453,
  solana: 501,
  sol: 501,
}

export async function auditGateToken(chainId: string, address: string): Promise<MemeRiskAudit | null> {
  const numericChainId = GATE_CHAIN_ID[chainId.toLowerCase()] ?? chainId
  const raw = await gateDex<GateRiskResponse>('base.token.risk_infos', {
    chain_id: String(numericChainId),
    address,
    lan: 'en',
  })
  if (raw.code !== undefined && raw.code !== 0 && String(raw.code) !== '0') {
    throw new Error(`Gate risk_infos ${raw.code}: ${raw.msg ?? raw.message ?? ''}`)
  }
  const d = raw.data
  if (!d) return null

  const high = toNum(d.high_risk_num)
  const mid = toNum(d.middle_risk_num)
  const low = toNum(d.low_risk_num)
  const riskLevel = Math.min(3, high + (mid > 0 ? 1 : 0))
  const label: MemeRiskAudit['riskLabel'] =
    riskLevel >= 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'

  const all = [
    ...(d.all_analysis?.high_risk_list ?? []),
    ...(d.all_analysis?.middle_risk_list ?? []),
    ...(d.all_analysis?.low_risk_list ?? []),
  ]

  return {
    id: `${chainId}:${address}`,
    platform: 'gate',
    chain: chainId,
    contract: address,
    symbol: '',
    name: '',
    riskLevel,
    riskLabel: label,
    buyTax: 0, // TODO: extract from is_high_tax risk_value when semantics confirmed
    sellTax: 0,
    top10HolderPercent: 0, // TODO: extract from is_high_holder_concentration
    lpLockedPercent: -1,
    canFreeze: riskFlag(all, 'freeze_authority') === '1' || riskFlag(all, 'is_freezeable') === '1',
    canMint: riskFlag(all, 'mint_authority') === '1' || riskFlag(all, 'is_mintable') === '1',
    riskCounts: { high, middle: mid, low },
    auditedAt: Date.now(),
  }
}
