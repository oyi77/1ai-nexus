// ─────────────────────────────────────────────────────────────
// Module: Gate.io DEX — Meme Alpha (new-token discovery + honeypot audit)
// sourceType: public-api
// upstreamProduct: Gate.io Web3 OpenAPI (DEX token endpoints)
// endpoint: https://openapi.gateweb3.cc/api/v1/dex  (POST, HMAC-SHA256 signed)
// discoveredVia: docs
// lastVerified: 2026-08-28
// Signing: path fixed `/api/v1/dex`; ts millisecond; JSON compact
//   separators=(',',':'); X-Request-Id NOT signed.
// Auth: public default AK/SK (Basic tier 2 QPS). Override via
//   GATE_DEX_API_KEY / GATE_DEX_SECRET_KEY env for higher quota.
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { TTL } from '../../types'
import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'

const MODULE_ID = 'gate-meme'
const GATE_TTL = TTL.TOKEN_DATA * 3 // 60s × 3 = 180s
const GATE_HOST = 'https://openapi.gateweb3.cc'
const GATE_PATH = '/api/v1/dex'

const API_KEY = process.env.GATE_DEX_API_KEY ?? '7RAYBKMG5MNMKK7LN6YGCO5UDI'
const SECRET_KEY =
  process.env.GATE_DEX_SECRET_KEY ?? 'COnwcshYA3EK4BjBWWrvwAqUXrvxgo0wGNvmoHk7rl4.6YLniz4h'

// Gate Web3 chain ids we care about for meme discovery.
// 1=ETH 56=BSC 8453=Base 999=Solana (gate uses numeric chain_id).
const DISCOVERY_CHAIN_IDS = [56, 1, 8453, 999]

interface GateRawToken {
  chain_id?: number
  token_address?: string
  name?: string
  symbol?: string
  price?: number | string
  trend_info?: { price_change_24h?: number | string; volume_24h?: number | string }
  liquidity?: number | string
  market_cap?: number | string
  holder_count?: number
  created_at?: number // ms epoch
  risk_level?: number
  social?: { twitter?: string; telegram?: string; website?: string }
}

interface GateRangeResponse {
  code?: string | number
  message?: string
  data?: { list?: GateRawToken[] }
}

interface GateRiskInfo {
  high_risk_num?: number
  middle_risk_num?: number
  low_risk_num?: number
  token_tax?: { buy_tax?: number | string; sell_tax?: number | string }
  top10_percent?: number | string
  is_honeypot?: boolean
  liquidity_locked?: number | string
  can_freeze?: boolean
  can_mint?: boolean
}

interface GateRiskResponse {
  code?: string | number
  message?: string
  data?: GateRiskInfo
}

// ── Signing ────────────────────────────────────────────────────

function buildGateHeaders(action: string): Record<string, string> {
  const ts = String(Date.now())
  const nonce = crypto.randomUUID()
  const method = 'POST'
  // canonical string: method + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + action
  const canonical = `${method}\n${GATE_PATH}\n${ts}\n${nonce}\n${action}`
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(canonical, 'utf8')
    .digest('hex')
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': API_KEY,
    'X-Timestamp': ts,
    'X-Nonce': nonce,
    'X-Signature': signature,
    'X-Action': action,
  }
}

async function gateDex<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${GATE_HOST}${GATE_PATH}`, {
    method: 'POST',
    headers: buildGateHeaders(action),
    body: JSON.stringify({ action, params }),
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
  const start = new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString() // last 30d
  const end = new Date(now).toISOString()
  for (const chainId of DISCOVERY_CHAIN_IDS) {
    const raw = await gateDex<GateRangeResponse>('base.token.range_by_created_at', {
      start,
      end,
      chain_id: chainId,
      limit: limitPerChain,
    })
    if (raw.code !== undefined && raw.code !== 0 && String(raw.code) !== '0') {
      throw new Error(`Gate range_by_created_at ${raw.code}: ${raw.message ?? ''}`)
    }
    const list = raw.data?.list ?? []
    for (const t of list) {
      if (!t.token_address) continue
      const chain = String(t.chain_id ?? chainId)
      const contract = t.token_address
      out.push({
        id: `${chain}:${contract}`,
        platform: 'gate' as MemePlatform,
        chain,
        contract,
        symbol: t.symbol ?? '',
        name: t.name ?? '',
        price: toNum(t.price),
        change24h: toNum(t.trend_info?.price_change_24h) / 100,
        volume24h: toNum(t.trend_info?.volume_24h),
        marketCap: toNum(t.market_cap),
        liquidity: toNum(t.liquidity),
        createdAt: toNum(t.created_at) || null,
        riskLevel: toNum(t.risk_level),
        holders: toNum(t.holder_count),
        top10HolderPercent: 0,
        social: {
          twitter: t.social?.twitter,
          telegram: t.social?.telegram,
          site: t.social?.website,
        },
        audited: false,
      })
    }
  }
  return out
}

// ── Risk audit ─────────────────────────────────────────────────

export async function auditGateToken(chainId: string, address: string): Promise<MemeRiskAudit | null> {
  const raw = await gateDex<GateRiskResponse>('base.token.risk_infos', {
    chain_id: Number(chainId),
    address,
    lan: 'en',
  })
  if (raw.code !== undefined && raw.code !== 0 && String(raw.code) !== '0') {
    throw new Error(`Gate risk_infos ${raw.code}: ${raw.message ?? ''}`)
  }
  const d = raw.data
  if (!d) return null
  const riskLevel = Math.min(3, toNum(d.high_risk_num) + (toNum(d.middle_risk_num) > 0 ? 1 : 0))
  const label: MemeRiskAudit['riskLabel'] =
    riskLevel >= 3 ? 'high' : riskLevel === 2 ? 'middle' : riskLevel === 1 ? 'low' : 'safe'
  return {
    id: `${chainId}:${address}`,
    platform: 'gate',
    chain: chainId,
    contract: address,
    symbol: '',
    name: '',
    riskLevel,
    riskLabel: label,
    buyTax: toNum(d.token_tax?.buy_tax) / 100,
    sellTax: toNum(d.token_tax?.sell_tax) / 100,
    top10HolderPercent: toNum(d.top10_percent) / 100,
    lpLockedPercent: toNum(d.liquidity_locked, -1) === -1 ? -1 : toNum(d.liquidity_locked) / 100,
    canFreeze: Boolean(d.can_freeze),
    canMint: Boolean(d.can_mint),
    riskCounts: {
      high: toNum(d.high_risk_num),
      middle: toNum(d.middle_risk_num),
      low: toNum(d.low_risk_num),
    },
    auditedAt: Date.now(),
  }
}

