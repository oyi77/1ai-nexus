// ─────────────────────────────────────────────────────────────
// Hyperliquid DEX Client — Real DEX derivatives data
// Free public API, no auth required for market data
// Source: 1ai-trade-dex (backend/clients/hyperliquid_client.py)
// ─────────────────────────────────────────────────────────────

const HYPERLIQUID_API = 'https://api.hyperliquid.xyz'

interface HyperliquidMeta {
  universe: Array<{
    name: string
    szDecimals: number
    maxLeverage: number
    marginTableId: number
  }>
}


export interface HyperliquidMarket {
  symbol: string
  price: number
  markPrice: number
  indexPrice: number
  priceChange24h: number
  volume24h: number
  openInterest: number
  fundingRate: number
  maxLeverage: number
}

// Cache
let marketCache: HyperliquidMarket[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000 // 30 seconds

async function fetchJson<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${HYPERLIQUID_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}: ${endpoint}`)
  return res.json() as Promise<T>
}

export async function getHyperliquidMarkets(): Promise<HyperliquidMarket[]> {
  const now = Date.now()
  if (marketCache && now - cacheTimestamp < CACHE_TTL) {
    return marketCache
  }

  try {
    const [meta, contexts] = await fetchJson<[HyperliquidMeta, Array<{
      markPx: string
      oraclePx: string
      prevDayPx: string
      dayNtlVlm: string
      funding: string
      openInterest: string
    }>]>('/info', { type: 'metaAndAssetCtxs' })

    marketCache = meta.universe.map((metaInfo, index) => {
      const context = contexts[index]
      const price = parseFloat(context?.markPx) || 0
      const previousPrice = parseFloat(context?.prevDayPx) || 0
      return {
        symbol: metaInfo.name,
        price,
        markPrice: price,
        indexPrice: parseFloat(context?.oraclePx) || price,
        priceChange24h: previousPrice > 0 ? ((price - previousPrice) / previousPrice) * 100 : 0,
        volume24h: parseFloat(context?.dayNtlVlm) || 0,
        openInterest: parseFloat(context?.openInterest) || 0,
        fundingRate: parseFloat(context?.funding) || 0,
        maxLeverage: metaInfo.maxLeverage,
      }
    }).sort((a, b) => b.volume24h - a.volume24h)

    cacheTimestamp = now
    return marketCache
  } catch (err) {
    console.error('[Hyperliquid] Failed to fetch markets:', (err as Error).message)
    return marketCache || []
  }
}

export async function getHyperliquidFundingRates(): Promise<Array<{ symbol: string; rate: number; annualized: number }>> {
  const markets = await getHyperliquidMarkets()
  return markets.map(m => ({
    symbol: m.symbol,
    rate: m.fundingRate,
    annualized: m.fundingRate * 24 * 365 * 100, // hourly funding → annualized %
  }))
}

export async function getHyperliquidOpenInterest(): Promise<Array<{ symbol: string; oi: number; oiUsd: number }>> {
  const markets = await getHyperliquidMarkets()
  return markets.map(m => ({
    symbol: m.symbol,
    oi: m.openInterest,
    oiUsd: m.openInterest * m.price,
  }))
}

export async function getHyperliquidLeaderboard(): Promise<Array<{ address: string; pnl: number; volume: number }>> {
  try {
    const data = await fetchJson<Array<{ ethAddress: string; pnl: number; volume: number }>>('/info', { type: 'leaderboard' })
    return data.slice(0, 50).map(d => ({
      address: d.ethAddress,
      pnl: d.pnl,
      volume: d.volume,
    }))
  } catch {
    return []
  }
}
