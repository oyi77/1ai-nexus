// ─────────────────────────────────────────────────────────────
// Module: DEX Screener — Meme Alpha (trending + new tokens + search)
// sourceType: public-api
// upstreamProduct: DEX Screener (dexscreener.com)
// endpoint: https://api.dexscreener.com  (GET, NO AUTH required)
// discoveredVia: docs.dexscreener.com/api/reference
// lastVerified: 2026-08-28
// Auth: NONE. Public API, rate-limit 60 requests/minute.
// fallbackFn: none (route-level per-source error isolation handles gaps)
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemePlatform, MemeRiskAudit } from '../types'

const DEXSCREENER_BASE = 'https://api.dexscreener.com'

interface DexScreenerPair {
  chainId?: string
  dexId?: string
  url?: string
  pairAddress?: string
  baseToken?: { address?: string; name?: string; symbol?: string }
  quoteToken?: { address?: string; name?: string; symbol?: string }
  priceNative?: string
  priceUsd?: string
  txns?: Record<string, { buys?: number; sells?: number }>
  volume?: Record<string, number>
  priceChange?: Record<string, number>
  liquidity?: { usd?: number; base?: number; quote?: number }
  fdv?: number
  marketCap?: number
  pairCreatedAt?: number
  info?: { imageUrl?: string }
  boosts?: { active?: number }
}

// ── Normalizers ────────────────────────────────────────────────

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── HTTP ───────────────────────────────────────────────────────

async function dexScreenerGet<T>(path: string): Promise<T> {
  const res = await fetch(`${DEXSCREENER_BASE}${path}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`DEXScreener ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ── Discovery ──────────────────────────────────────────────────

/** New-token discovery: latest token boosts + trending search. */
export async function discoverDexScreenerTokens(limitPerChain = 25): Promise<MemeAlphaToken[]> {
  const out: MemeAlphaToken[] = []
  const seen = new Set<string>()

  // First, get trending tokens via search
  const trendingQueries = ['solana', 'bsc', 'base', 'ethereum', 'pump', 'pepe', 'doge', 'moon']
  for (const q of trendingQueries) {
    try {
      const data = await dexScreenerGet<{
        schemaVersion?: string
        pairs?: DexScreenerPair[]
      }>(`/latest/dex/search?q=${encodeURIComponent(q)}&limit=10`)
      const pairs = data.pairs ?? []
      for (const p of pairs) {
        if (!p.baseToken?.address || !p.chainId) continue
        const id = `${p.chainId}:${p.baseToken.address}`
        if (seen.has(id)) continue
        seen.add(id)
        out.push({
          id,
          platform: 'dexscreener' as MemePlatform,
          chain: p.chainId,
          contract: p.baseToken.address,
          symbol: p.baseToken.symbol ?? '',
          name: p.baseToken.name ?? '',
          price: toNum(p.priceUsd),
          change24h: toNum(p.priceChange?.h24),
          volume24h: toNum(p.volume?.h24),
          marketCap: toNum(p.marketCap),
          liquidity: toNum(p.liquidity?.usd),
          createdAt: p.pairCreatedAt ?? null,
          riskLevel: 0,
          holders: 0,
          top10HolderPercent: 0,
          social: {},
          audited: false,
        })
        if (out.length >= limitPerChain) break
      }
    } catch {
      // Per-source error isolation
    }
    if (out.length >= limitPerChain) break
  }

  return out
}

// ── Risk audit ─────────────────────────────────────────────────
// DEX Screener doesn't provide a direct risk audit endpoint.
// Returns null — route error-isolates it.

export async function auditDexScreenerToken(_chain: string, _contract: string): Promise<MemeRiskAudit | null> {
  return null
}
