// ─────────────────────────────────────────────────────────────
// Module: GeckoTerminal — Meme Alpha (trending + new pools discovery)
// sourceType: public-api
// upstreamProduct: GeckoTerminal (geckoterminal.com)
// endpoint: https://api.geckoterminal.com/api/v2/networks/solana/
// discoveredVia: docs
// lastVerified: 2026-08-30
// Auth: NONE. Public API, no key. Rate limit ~30 calls/min.
// Discovery-only module — buy/sell split per window complements Birdeye.
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import { TTL } from '../../types'
import type { MemeAlphaToken, MemeRiskAudit } from '../types'

const GECKO_TTL = TTL.TOKEN_DATA * 3 // 60s × 3 = 180s
const GECKO_BASE = 'https://api.geckoterminal.com/api/v2/networks/solana'

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Raw payload shapes (GeckoTerminal pools) ──────────────────

interface GeckoPoolAttrs {
  base_token_price_usd?: string
  address?: string
  name?: string
  pool_created_at?: string
  fdv_usd?: string
  market_cap_usd?: string
  price_change_percentage?: Record<string, string>
  volume_usd?: string
  reserve_in_usd?: string
}

interface GeckoPool {
  id?: string
  type?: string
  attributes?: GeckoPoolAttrs
  relationships?: {
    base_token?: { data?: { id?: string; type?: string } }
  }
}

interface GeckoPoolsResponse {
  data?: GeckoPool[]
  meta?: { total?: number }
}

// ── Normalizers ───────────────────────────────────────────────

/** Extract the token address from a GeckoTerminal relationship id ("solana_<addr>"). */
function tokenAddressFrom(pool: GeckoPool): string {
  const relId = pool.relationships?.base_token?.data?.id ?? ''
  const idx = relId.indexOf('_')
  return idx >= 0 ? relId.slice(idx + 1) : relId
}

// ── HTTP ─────────────────────────────────────────────────────

async function geckoGet<T>(path: string): Promise<T> {
  const res = await fetch(`${GECKO_BASE}${path}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ── Discovery ─────────────────────────────────────────────────

function poolToToken(pool: GeckoPool): MemeAlphaToken | null {
  const attrs = pool.attributes ?? {}
  const contract = tokenAddressFrom(pool)
  if (!contract || !attrs.base_token_price_usd) return null

  // name is "TOKEN / SOL" — symbol is the token side.
  const nameParts = (attrs.name ?? '').split('/').map((s) => s.trim())
  const symbol = nameParts[0] ?? ''
  const changePct = toNum(attrs.price_change_percentage?.h24)

  return {
    id: `solana:${contract}`,
    platform: 'geckoterminal',
    chain: 'solana',
    contract,
    symbol,
    name: symbol,
    price: toNum(attrs.base_token_price_usd),
    change24h: changePct / 100,
    volume24h: toNum(attrs.volume_usd),
    marketCap: toNum(attrs.market_cap_usd),
    liquidity: toNum(attrs.reserve_in_usd),
    createdAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : null,
    riskLevel: 0,
    holders: 0,
    top10HolderPercent: 0,
    social: {},
    audited: false,
  }
}

/** New-token discovery: trending pools + new pools on Solana. */
export async function discoverGeckoTerminalTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  const seen = new Set<string>()
  const pages = ['/trending_pools?page=1', '/new_pools?page=1']

  for (const path of pages) {
    try {
      const res = await geckoGet<GeckoPoolsResponse>(path)
      for (const pool of res.data ?? []) {
        const token = poolToToken(pool)
        if (!token || seen.has(token.contract)) continue
        seen.add(token.contract)
        out.push(token)
        if (out.length >= limitPerChain) break
      }
    } catch {
      // Per-source error isolation — one page failing never breaks discovery
    }
    if (out.length >= limitPerChain) break
  }

  return out
}

// ── Risk audit ─────────────────────────────────────────────────
// GeckoTerminal doesn't provide a security audit endpoint.
// Returns null — route error-isolates it.

export async function auditGeckoTerminalToken(_chain: string, _contract: string): Promise<MemeRiskAudit | null> {
  return null
}
