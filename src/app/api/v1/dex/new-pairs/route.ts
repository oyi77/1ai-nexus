// ─────────────────────────────────────────────────────────────
// GET /api/v1/dex/new-pairs — Newly created DEX pools
// GeckoTerminal API (free, no key required)
// Server-side cached: 15s TTL, single-flight dedup
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface GeckoNewPool {
  attributes: {
    address: string
    name: string
    base_token_price_usd: string
    fdv_usd: string
    reserve_in_usd: string
    pool_created_at: string
    volume_usd: { m5: string; h1: string }
    transactions: { m5: { buys: number; sells: number } }
  }
}

async function fetchNewPairs(network: string) {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?page=1`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GeckoTerminal error: ${res.status}`)

  const data = (await res.json()) as { data: GeckoNewPool[] }
  const now = Date.now()

  return data.data.map((pool) => {
    const created = new Date(pool.attributes.pool_created_at).getTime()
    const ageMinutes = Math.floor((now - created) / 60_000)
    const liquidity = parseFloat(pool.attributes.reserve_in_usd) || 0
    const fdv = parseFloat(pool.attributes.fdv_usd) || 0

    let rugRisk = 'Medium'
    if (liquidity < 1_000) rugRisk = 'High'
    else if (liquidity > 20_000 && fdv > 50_000) rugRisk = 'Low'

    return {
      address: pool.attributes.address,
      name: pool.attributes.name,
      priceUsd: parseFloat(pool.attributes.base_token_price_usd) || 0,
      fdv,
      liquidity,
      ageMinutes,
      volume5m: parseFloat(pool.attributes.volume_usd?.m5) || 0,
      buys5m: pool.attributes.transactions?.m5?.buys || 0,
      sells5m: pool.attributes.transactions?.m5?.sells || 0,
      rugRisk,
      riskScore: rugRisk === 'High' ? 90 : rugRisk === 'Low' ? 15 : 50,
    }
  })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const network = searchParams.get('network') || 'solana'

    const { data, fromCache } = await getCached(
      `dex:new-pairs:${network}`,
      15_000,
      () => fetchNewPairs(network),
    )

    const sorted = data.sort((a, b) => a.ageMinutes - b.ageMinutes)

    const resp = NextResponse.json({ data: { items: sorted, count: sorted.length }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('DEX new pairs error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch new DEX pairs' }, { status: 502 })
  }
}
