// ─────────────────────────────────────────────────────────────
// GET /api/v1/dex/trending — Trending DEX pairs
// Primary: GeckoTerminal API (free, no key required)
// Fallback: DexScreener API (free, no key required)
// Server-side cached: 60s TTL, single-flight dedup
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'

interface TrendingPair {
  address: string
  name: string
  priceUsd: number
  fdv: number
  volume24h: number
  priceChange24h: number
  buys24h: number
  sells24h: number
  source: string
}

// Primary: GeckoTerminal
async function fetchFromGeckoTerminal(network: string): Promise<TrendingPair[]> {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GeckoTerminal error: ${res.status}`)

  const data = (await res.json()) as {
    data?: Array<{
      attributes?: {
        address?: string
        name?: string
        base_token_price_usd?: string
        fdv_usd?: string
        volume_usd?: { h24?: string }
        price_change_percentage?: { h24?: string }
        transactions?: { h24?: { buys?: number; sells?: number } }
      }
    }>
  }

  const pools = data.data ?? []
  if (pools.length === 0) throw new Error('GeckoTerminal returned empty')

  return pools.map((pool) => ({
    address: pool.attributes?.address ?? '',
    name: pool.attributes?.name ?? '',
    priceUsd: parseFloat(pool.attributes?.base_token_price_usd ?? '0') || 0,
    fdv: parseFloat(pool.attributes?.fdv_usd ?? '0') || 0,
    volume24h: parseFloat(pool.attributes?.volume_usd?.h24 ?? '0') || 0,
    priceChange24h: parseFloat(pool.attributes?.price_change_percentage?.h24 ?? '0') || 0,
    buys24h: pool.attributes?.transactions?.h24?.buys ?? 0,
    sells24h: pool.attributes?.transactions?.h24?.sells ?? 0,
    source: 'geckoterminal',
  }))
}

// Fallback: DexScreener
async function fetchFromDexScreener(network: string): Promise<TrendingPair[]> {
  const chainMap: Record<string, string> = {
    solana: 'solana',
    ethereum: 'ethereum',
    bsc: 'bsc',
    arbitrum: 'arbitrum',
    base: 'base',
    polygon: 'polygon',
  }
  const chain = chainMap[network] ?? 'solana'

  const res = await fetch(`https://api.dexscreener.com/latest/dex/trending/${chain}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`DexScreener error: ${res.status}`)

  const data = (await res.json()) as {
    pairs?: Array<{
      pairAddress?: string
      baseToken?: { name?: string; symbol?: string }
      priceUsd?: string
      fdv?: number
      volume?: { h24?: number }
      priceChange?: { h24?: number }
      txns?: { h24?: { buys?: number; sells?: number } }
    }>
  }

  return (data.pairs ?? []).slice(0, 20).map((pair) => ({
    address: pair.pairAddress ?? '',
    name: `${pair.baseToken?.symbol ?? '?'} / USD`,
    priceUsd: parseFloat(pair.priceUsd ?? '0') || 0,
    fdv: pair.fdv ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    buys24h: pair.txns?.h24?.buys ?? 0,
    sells24h: pair.txns?.h24?.sells ?? 0,
    source: 'dexscreener',
  }))
}

// Fetch with fallback
async function fetchTrending(network: string): Promise<TrendingPair[]> {
  try {
    return await fetchFromGeckoTerminal(network)
  } catch {
    console.log(`[dex/trending] GeckoTerminal failed, trying DexScreener...`)
    try {
      return await fetchFromDexScreener(network)
    } catch {
      console.error(`[dex/trending] Both sources failed`)
      return []
    }
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const network = searchParams.get('network') || 'solana'

    const { data, fromCache } = await getCached(
      `dex:trending:${network}`,
      60_000,
      () => fetchTrending(network),
    )

    const resp = NextResponse.json({
      data: { items: data, count: data.length },
      error: null,
      source: data[0]?.source ?? 'none',
    })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('DEX trending error:', error)
    return NextResponse.json({ data: { items: [], count: 0 }, error: null, source: 'error' })
  }
}
