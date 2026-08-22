// ─────────────────────────────────────────────────────────────
// Market Ticks — Unified DEX + CEX price time-series
// Builds the shared price history consumed by the DEX/CEX lead-lag
// matrix (P4) and the opportunity ranker (P5). Reuses the existing
// MarketSnapshot model (symbol = asset, sourceId = venue) so no
// schema migration is required. All sources are keyless public APIs.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface MarketTick {
  symbol: string // canonical asset, e.g. 'BTC', 'SOL', 'WIF'
  venue: string // 'cex:coingecko' | 'dex:dexscreener'
  price: number
}

interface WatchAsset {
  symbol: string
  cexId: string // CoinGecko coin id
  dexAddress?: string // Solana mint for DexScreener
}

// MVP watchlist — majors + liquid Solana memecoins with stable mints.
const WATCHLIST: WatchAsset[] = [
  { symbol: 'BTC', cexId: 'bitcoin' },
  { symbol: 'ETH', cexId: 'ethereum' },
  { symbol: 'SOL', cexId: 'solana', dexAddress: 'So11111111111111111111111111111111111111112' },
  { symbol: 'WIF', cexId: 'dogwifcoin', dexAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { symbol: 'BONK', cexId: 'bonk', dexAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
]

const COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price'

async function fetchCexPrices(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const url = `${COINGECKO_SIMPLE}?ids=${ids.join(',')}&vs_currencies=usd`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return new Map()
    const json = (await res.json()) as Record<string, { usd?: number }>
    const m = new Map<string, number>()
    for (const [id, v] of Object.entries(json)) {
      if (v && typeof v.usd === 'number') m.set(id, v.usd)
    }
    return m
  } catch {
    return new Map()
  }
}

async function fetchDexPrice(address: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${address}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const pairs = (await res.json()) as Array<{ priceUsd?: string | number }>
    for (const p of pairs) {
      const price = typeof p.priceUsd === 'number' ? p.priceUsd : parseFloat(String(p.priceUsd))
      if (price > 0) return price
    }
    return null
  } catch {
    return null
  }
}

export async function fetchMarketTicks(): Promise<MarketTick[]> {
  const cexIds = [...new Set(WATCHLIST.map((w) => w.cexId))]
  const [cex] = await Promise.allSettled([fetchCexPrices(cexIds)])
  const cexMap = cex.status === 'fulfilled' ? cex.value : new Map<string, number>()

  const ticks: MarketTick[] = []

  // CEX leg (synchronous over the resolved map)
  for (const w of WATCHLIST) {
    const cexPrice = cexMap.get(w.cexId)
    if (cexPrice != null) ticks.push({ symbol: w.symbol, venue: 'cex:coingecko', price: cexPrice })
  }

  // DEX leg (parallel per-asset)
  const dexFetches = WATCHLIST.filter((w) => w.dexAddress).map(async (w) => {
    const price = await fetchDexPrice(w.dexAddress!)
    if (price != null) ticks.push({ symbol: w.symbol, venue: 'dex:dexscreener', price })
  })
  await Promise.allSettled(dexFetches)

  return ticks
}

export async function persistMarketTicks(ticks: MarketTick[]): Promise<number> {
  let count = 0
  for (const t of ticks) {
    try {
      await prisma.marketSnapshot.create({
        data: {
          symbol: t.symbol,
          sourceId: t.venue,
          price: t.price,
        },
      })
      count++
    } catch {
      /* skip */
    }
  }
  return count
}
