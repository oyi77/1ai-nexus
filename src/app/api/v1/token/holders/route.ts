// ─────────────────────────────────────────────────────────────
// GET /api/v1/token/holders?address=0x...&network=eth
// Token holders God Mode (Nansen-style)
// Uses GeckoTerminal for token metadata + Entity DB for attribution
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'

async function fetchTokenHolders(address: string, network: string) {
  // Fetch token info from GeckoTerminal
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`GeckoTerminal error: ${res.status}`)

  const data = (await res.json()) as {
    data: {
      attributes: {
        symbol: string
        name: string
        decimals: number
        price_usd: string
        fdv_usd: string
        market_cap_usd: string
        total_supply: string
        normalized_total_supply: string
        volume_usd: { h24: string }
        coingecko_coin_id: string | null
      }
    }
  }

  const token = data.data.attributes

  // Cross-reference with Entity DB for known holders
  const knownWallets = await prisma.wallet.findMany({
    where: {
      OR: [
        { address: { equals: address, mode: 'insensitive' } },
        { entity: { name: { contains: token.symbol, mode: 'insensitive' } } },
      ],
    },
    include: { entity: { select: { name: true, type: true, totalUsdValue: true, verified: true } } },
  })

  // Build holder profile
  const holders = knownWallets
    .filter(w => w.entity)
    .map(w => ({
      address: w.address,
      chain: w.chain,
      label: w.entity!.name,
      type: w.entity!.type,
      verified: w.entity!.verified,
      tvl: w.entity!.totalUsdValue,
      isContract: false,
    }))

  // Estimate distribution by type
  const distribution = {
    exchange: holders.filter(h => h.type === 'exchange').length,
    fund: holders.filter(h => h.type === 'fund').length,
    protocol: holders.filter(h => h.type === 'protocol').length,
    bridge: holders.filter(h => h.type === 'bridge').length,
    whale: holders.filter(h => h.type === 'whale').length,
  }

  return {
    token: {
      address,
      symbol: token.symbol,
      name: token.name,
      price: parseFloat(token.price_usd),
      fdv: parseFloat(token.fdv_usd),
      marketCap: parseFloat(token.market_cap_usd),
      totalSupply: parseFloat(token.normalized_total_supply),
      volume24h: parseFloat(token.volume_usd.h24),
      coingeckoId: token.coingecko_coin_id,
    },
    knownHolders: holders,
    distribution,
    holderCount: holders.length,
    timestamp: Date.now(),
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const address = searchParams.get('address')
    const network = searchParams.get('network') ?? 'eth'

    if (!address) {
      return NextResponse.json({ data: null, error: 'address parameter required' }, { status: 400 })
    }

    const { data, fromCache } = await getCached(
      `token-holders:${network}:${address}`,
      60_000, // 1min cache
      () => fetchTokenHolders(address, network),
    )

    const resp = NextResponse.json({ data, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Token holders error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch token holders' }, { status: 502 })
  }
}