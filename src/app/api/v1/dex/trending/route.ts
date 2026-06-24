// ─────────────────────────────────────────────────────────────
// GET /api/v1/dex/trending — Trending DEX pairs
// GeckoTerminal API (free, no key required)
// Server-side cached: 60s TTL, single-flight dedup
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface GeckoPool {
  attributes: {
    address: string
    name: string
    base_token_price_usd: string
    fdv_usd: string
    volume_usd: { h24: string }
    price_change_percentage: { h24: string }
    transactions: { h24: { buys: number; sells: number } }
  }
}

async function fetchTrending(network: string) {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GeckoTerminal error: ${res.status}`)

  const data = (await res.json()) as { data: GeckoPool[] }
  return data.data.map((pool) => ({
    address: pool.attributes.address,
    name: pool.attributes.name,
    priceUsd: parseFloat(pool.attributes.base_token_price_usd) || 0,
    fdv: parseFloat(pool.attributes.fdv_usd) || 0,
    volume24h: parseFloat(pool.attributes.volume_usd?.h24) || 0,
    priceChange24h: parseFloat(pool.attributes.price_change_percentage?.h24) || 0,
    buys24h: pool.attributes.transactions?.h24?.buys || 0,
    sells24h: pool.attributes.transactions?.h24?.sells || 0,
  }))
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

    const resp = NextResponse.json({ data: { items: data, count: data.length }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('DEX trending error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch DEX trending' }, { status: 502 })
  }
}
