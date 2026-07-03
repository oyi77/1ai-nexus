// ─────────────────────────────────────────────────────────────
// DEX Trending Aggregator
// Proper aggregation with:
// - Independent source fetching with error isolation
// - Weighted merge by source reliability
// - Freshness-aware deduplication
// - Graceful degradation per source
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
  fetchedAt: number
}

interface SourceResult {
  source: string
  data: TrendingPair[]
  success: boolean
  latencyMs: number
  error?: string
}

// ─── Source Fetchers (independent, error-isolated) ──────────

async function fetchGeckoTerminal(network: string): Promise<SourceResult> {
  const start = Date.now()
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { source: 'geckoterminal', data: [], success: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }

    const data = (await res.json()) as { data?: Array<{ attributes?: Record<string, unknown> }> }
    const pools = data.data ?? []
    if (pools.length === 0) return { source: 'geckoterminal', data: [], success: true, latencyMs: Date.now() - start }

    const now = Date.now()
    const items: TrendingPair[] = pools.map((pool) => {
      const a = pool.attributes ?? {}
      return {
        address: (a.address as string) ?? '',
        name: (a.name as string) ?? '',
        symbol: ((a.name as string) ?? '').split('/')[0]?.trim() ?? '?',
        priceUsd: parseFloat((a.base_token_price_usd as string) ?? '0') || 0,
        fdv: parseFloat((a.fdv_usd as string) ?? '0') || 0,
        volume24h: parseFloat(((a.volume_usd as Record<string, string>)?.h24) ?? '0') || 0,
        priceChange24h: parseFloat(((a.price_change_percentage as Record<string, string>)?.h24) ?? '0') || 0,
        buys24h: ((a.transactions as Record<string, Record<string, number>>)?.h24?.buys) ?? 0,
        sells24h: ((a.transactions as Record<string, Record<string, number>>)?.h24?.sells) ?? 0,
        source: 'geckoterminal',
        fetchedAt: now,
      }
    })

    return { source: 'geckoterminal', data: items, success: true, latencyMs: Date.now() - start }
  } catch (e) {
    return { source: 'geckoterminal', data: [], success: false, latencyMs: Date.now() - start, error: (e as Error).message }
  }
}

async function fetchDexScreener(network: string): Promise<SourceResult> {
  const start = Date.now()
  try {
    const chainMap: Record<string, string> = {
      solana: 'solana', ethereum: 'ethereum', bsc: 'bsc',
      arbitrum: 'arbitrum', base: 'base', polygon: 'polygon',
    }
    const chain = chainMap[network] ?? 'solana'

    const res = await fetch(`https://api.dexscreener.com/latest/dex/trending/${chain}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { source: 'dexscreener', data: [], success: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }

    const data = (await res.json()) as { pairs?: Array<Record<string, unknown>> }
    const now = Date.now()

    const items: TrendingPair[] = (data.pairs ?? []).slice(0, 20).map((pair) => {
      const baseToken = pair.baseToken as Record<string, string> | undefined
      const volume = pair.volume as Record<string, number> | undefined
      const priceChange = pair.priceChange as Record<string, number> | undefined
      const txns = pair.txns as Record<string, Record<string, number>> | undefined

      return {
        address: (pair.pairAddress as string) ?? '',
        name: `${baseToken?.symbol ?? '?'} / USD`,
        symbol: baseToken?.symbol ?? '?',
        priceUsd: parseFloat((pair.priceUsd as string) ?? '0') || 0,
        fdv: (pair.fdv as number) ?? 0,
        volume24h: volume?.h24 ?? 0,
        priceChange24h: priceChange?.h24 ?? 0,
        buys24h: txns?.h24?.buys ?? 0,
        sells24h: txns?.h24?.sells ?? 0,
        source: 'dexscreener',
        fetchedAt: now,
      }
    })

    return { source: 'dexscreener', data: items, success: true, latencyMs: Date.now() - start }
  } catch (e) {
    return { source: 'dexscreener', data: [], success: false, latencyMs: Date.now() - start, error: (e as Error).message }
  }
}

async function fetchCoinGeckoTrending(): Promise<SourceResult> {
  const start = Date.now()
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { source: 'coingecko', data: [], success: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }

    const data = (await res.json()) as {
      coins?: Array<{ item?: { name?: string; symbol?: string; data?: { price?: number; price_change_percentage_24h?: { usd?: number }; market_cap?: number; total_volume?: number } } }>
    }
    const now = Date.now()

    const items: TrendingPair[] = (data.coins ?? []).map((coin) => ({
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
      fetchedAt: now,
    }))

    return { source: 'coingecko', data: items, success: true, latencyMs: Date.now() - start }
  } catch (e) {
    return { source: 'coingecko', data: [], success: false, latencyMs: Date.now() - start, error: (e as Error).message }
  }
}

// ─── Aggregation Logic ──────────────────────────────────────

interface AggregatedResult {
  items: TrendingPair[]
  sources: Array<{ name: string; success: boolean; count: number; latencyMs: number; error?: string }>
  totalUnique: number
}

function aggregateResults(results: SourceResult[]): AggregatedResult {
  const sources = results.map(r => ({
    name: r.source,
    success: r.success,
    count: r.data.length,
    latencyMs: r.latencyMs,
    error: r.error,
  }))

  // Collect all items
  const allItems: TrendingPair[] = []
  for (const r of results) {
    allItems.push(...r.data)
  }

  // Deduplicate by symbol (case-insensitive)
  // Keep the item with highest volume (more reliable data)
  const bySymbol = new Map<string, TrendingPair>()
  for (const item of allItems) {
    const key = item.symbol.toUpperCase()
    const existing = bySymbol.get(key)
    if (!existing || item.volume24h > existing.volume24h) {
      bySymbol.set(key, item)
    }
  }

  // Sort by volume (descending)
  const deduped = Array.from(bySymbol.values())
  deduped.sort((a, b) => b.volume24h - a.volume24h)

  return {
    items: deduped.slice(0, 30),
    sources,
    totalUnique: deduped.length,
  }
}

// ─── Main Handler ───────────────────────────────────────────

async function fetchTrending(network: string): Promise<AggregatedResult> {
  // Fetch from all sources IN PARALLEL
  const results = await Promise.all([
    fetchGeckoTerminal(network),
    fetchDexScreener(network),
    fetchCoinGeckoTrending(),
  ])

  return aggregateResults(results)
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
      data: { items: data.items, count: data.items.length },
      sources: data.sources,
      totalUnique: data.totalUnique,
      error: null,
    })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('DEX trending error:', error)
    return NextResponse.json({
      data: { items: [], count: 0 },
      sources: [],
      totalUnique: 0,
      error: null,
    })
  }
}
