// ─────────────────────────────────────────────────────────────
// GET /api/v1/dex/trending — Trending DEX pairs
// AGGREGATES data from multiple sources:
// 1. GeckoTerminal (20 pools)
// 2. DexScreener (20 pairs)
// 3. CoinGecko trending (15 coins)
// Deduplicates by symbol, merges volume data
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getCached } from '@/lib/api/server-cache'

interface TrendingPair {
  address: string
  name: string
  symbol: string
  priceUsd: number
  fdv: number
  volume24h: number
  priceChange24h: number
  buys24h: number
  sells24h: number
  source: string
}

// Source 1: GeckoTerminal
async function fetchGeckoTerminal(network: string): Promise<TrendingPair[]> {
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []

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

    return (data.data ?? []).map((pool) => ({
      address: pool.attributes?.address ?? '',
      name: pool.attributes?.name ?? '',
      symbol: pool.attributes?.name?.split('/')[0]?.trim() ?? '?',
      priceUsd: parseFloat(pool.attributes?.base_token_price_usd ?? '0') || 0,
      fdv: parseFloat(pool.attributes?.fdv_usd ?? '0') || 0,
      volume24h: parseFloat(pool.attributes?.volume_usd?.h24 ?? '0') || 0,
      priceChange24h: parseFloat(pool.attributes?.price_change_percentage?.h24 ?? '0') || 0,
      buys24h: pool.attributes?.transactions?.h24?.buys ?? 0,
      sells24h: pool.attributes?.transactions?.h24?.sells ?? 0,
      source: 'geckoterminal',
    }))
  } catch {
    return []
  }
}

// Source 2: DexScreener
async function fetchDexScreener(network: string): Promise<TrendingPair[]> {
  try {
    const chainMap: Record<string, string> = {
      solana: 'solana', ethereum: 'ethereum', bsc: 'bsc',
      arbitrum: 'arbitrum', base: 'base', polygon: 'polygon',
    }
    const chain = chainMap[network] ?? 'solana'

    const res = await fetch(`https://api.dexscreener.com/latest/dex/trending/${chain}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []

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
      symbol: pair.baseToken?.symbol ?? '?',
      priceUsd: parseFloat(pair.priceUsd ?? '0') || 0,
      fdv: pair.fdv ?? 0,
      volume24h: pair.volume?.h24 ?? 0,
      priceChange24h: pair.priceChange?.h24 ?? 0,
      buys24h: pair.txns?.h24?.buys ?? 0,
      sells24h: pair.txns?.h24?.sells ?? 0,
      source: 'dexscreener',
    }))
  } catch {
    return []
  }
}

// Source 3: CoinGecko trending
async function fetchCoinGeckoTrending(): Promise<TrendingPair[]> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []

    const data = (await res.json()) as {
      coins?: Array<{
        item?: {
          name?: string
          symbol?: string
          data?: { price?: number; price_change_percentage_24h?: { usd?: number }; market_cap?: number; total_volume?: number }
        }
      }>
    }

    return (data.coins ?? []).map((coin) => ({
      address: '',
      name: coin.item?.name ?? '',
      symbol: coin.item?.symbol?.toUpperCase() ?? '?',
      priceUsd: coin.item?.data?.price ?? 0,
      fdv: coin.item?.data?.market_cap ?? 0,
      volume24h: coin.item?.data?.total_volume ?? 0,
      priceChange24h: coin.item?.data?.price_change_percentage_24h?.usd ?? 0,
      buys24h: 0,
      sells24h: 0,
      source: 'coingecko',
    }))
  } catch {
    return []
  }
}

// Aggregate + deduplicate
async function fetchTrending(network: string): Promise<TrendingPair[]> {
  const [gecko, dex, cg] = await Promise.all([
    fetchGeckoTerminal(network),
    fetchDexScreener(network),
    fetchCoinGeckoTrending(),
  ])

  // Combine all sources
  const all = [...gecko, ...dex, ...cg]

  // Deduplicate by symbol (keep highest volume)
  const bySymbol = new Map<string, TrendingPair>()
  for (const pair of all) {
    const key = pair.symbol.toUpperCase()
    const existing = bySymbol.get(key)
    if (!existing || pair.volume24h > existing.volume24h) {
      bySymbol.set(key, pair)
    }
  }

  // Sort by volume
  const deduped = Array.from(bySymbol.values())
  deduped.sort((a, b) => b.volume24h - a.volume24h)

  return deduped.slice(0, 30)
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

    // Count sources
    const sources = new Set(data.map(d => d.source))

    const resp = NextResponse.json({
      data: { items: data, count: data.length },
      sources: Array.from(sources),
      error: null,
    })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('DEX trending error:', error)
    return NextResponse.json({ data: { items: [], count: 0 }, sources: [], error: null })
  }
}
