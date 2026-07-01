// ─────────────────────────────────────────────────────────────
// Stablecoin Intelligence Module
// Tracks stablecoin supply dynamics — the "blood supply" of crypto
// Zero API keys — uses CoinGecko public endpoints
// ─────────────────────────────────────────────────────────────

const CG_BASE = 'https://api.coingecko.com/api/v3'
const STABLECOIN_IDS = ['tether', 'usd-coin', 'dai', 'first-digital-usd', 'true-usd']
const STABLECOIN_SYMBOLS: Record<string, string> = {
  tether: 'USDT',
  'usd-coin': 'USDC',
  dai: 'DAI',
  'first-digital-usd': 'FDUSD',
  'true-usd': 'TUSD',
}

interface CoinMarketData {
  id: string
  symbol: string
  name: string
  market_cap: number
  price_change_percentage_24h: number | null
}

interface CoinGeckoGlobal {
  data: {
    total_market_cap: { usd: number }
  }
}

export interface StablecoinData {
  symbol: string
  name: string
  marketCap: number
  change24h: number
}

export interface StablecoinIntelResult {
  coins: StablecoinData[]
  totalSupply: number
  totalMarketCap: number
  dominance: number
  supplyChange24h: number
  ssr: number | null
  signal: 'risk-on' | 'risk-off' | 'neutral'
  signalReason: string
}

// ─── Fetch CoinGecko stablecoin markets ─────────────────────

async function fetchStablecoinMarkets(): Promise<CoinMarketData[]> {
  const ids = STABLECOIN_IDS.join(',')
  const res = await fetch(
    `${CG_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false`,
    { signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) return []
  return res.json() as Promise<CoinMarketData[]>
}

// ─── Fetch total crypto market cap ──────────────────────────

async function fetchTotalMarketCap(): Promise<number> {
  const res = await fetch(`${CG_BASE}/global`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return 0
  const data = (await res.json()) as CoinGeckoGlobal
  return data.data?.total_market_cap?.usd ?? 0
}

// ─── Fetch BTC market cap for SSR ───────────────────────────

async function fetchBtcMarketCap(): Promise<number> {
  const res = await fetch(
    `${CG_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) return 0
  const data = (await res.json()) as { bitcoin?: { usd_market_cap?: number } }
  return data.bitcoin?.usd_market_cap ?? 0
}

// ─── Compute stablecoin intelligence ────────────────────────

export async function fetchStablecoinIntel(): Promise<StablecoinIntelResult> {
  const [markets, totalMarketCap, btcMarketCap] = await Promise.allSettled([
    fetchStablecoinMarkets(),
    fetchTotalMarketCap(),
    fetchBtcMarketCap(),
  ])

  const rawMarkets = markets.status === 'fulfilled' ? markets.value : []
  const mcap = totalMarketCap.status === 'fulfilled' ? totalMarketCap.value : 0
  const btcMcap = btcMarketCap.status === 'fulfilled' ? btcMarketCap.value : 0

  const coins: StablecoinData[] = rawMarkets.map((c) => ({
    symbol: STABLECOIN_SYMBOLS[c.id] ?? c.symbol.toUpperCase(),
    name: c.name,
    marketCap: c.market_cap ?? 0,
    change24h: c.price_change_percentage_24h ?? 0,
  }))

  const totalSupply = coins.reduce((s, c) => s + c.marketCap, 0)
  const dominance = mcap > 0 ? (totalSupply / mcap) * 100 : 0

  // Supply change: sum individual weighted changes
  const supplyChange24h = coins.reduce((s, c) => {
    const denom = 1 + c.change24h / 100
    if (denom === 0 || !isFinite(denom)) return s
    const prev = c.marketCap / denom
    return s + (c.marketCap - prev)
  }, 0)

  // SSR = BTC market cap / total stablecoin supply
  const ssr = totalSupply > 0 ? btcMcap / totalSupply : null

  // Signal: rising dominance = risk-off (money parking in stables), falling = risk-on
  let signal: 'risk-on' | 'risk-off' | 'neutral' = 'neutral'
  let signalReason = 'Dominance stable — no clear directional signal'
  if (dominance > 10) {
    signal = 'risk-off'
    signalReason = `High stablecoin dominance at ${dominance.toFixed(1)}% — capital parked in stables`
  } else if (dominance < 6 && dominance > 0) {
    signal = 'risk-on'
    signalReason = `Low stablecoin dominance at ${dominance.toFixed(1)}% — capital deployed into risk assets`
  }

  if (supplyChange24h > 500_000_000) {
    signal = 'risk-on'
    signalReason = `+$${(supplyChange24h / 1e9).toFixed(2)}B new stablecoin supply — fresh capital entering`
  } else if (supplyChange24h < -500_000_000) {
    signal = 'risk-off'
    signalReason = `-$${(Math.abs(supplyChange24h) / 1e9).toFixed(2)}B stablecoin supply leaving — capital exiting`
  }

  return {
    coins,
    totalSupply,
    totalMarketCap: mcap,
    dominance,
    supplyChange24h,
    ssr,
    signal,
    signalReason,
  }
}

// ─── Persist to DB ──────────────────────────────────────────

import { prisma } from '@/lib/db'

export async function persistStablecoinSnapshot(intel: StablecoinIntelResult): Promise<number> {
  let count = 0
  const now = new Date()

  for (const coin of intel.coins) {
    try {
      await prisma.stablecoinSnapshot.create({
        data: {
          coin: coin.symbol,
          marketCap: coin.marketCap,
          dominance: intel.dominance,
          change24h: coin.change24h,
          timestamp: now,
        },
      })
      count++
    } catch { /* skip duplicate */ }
  }

  // Also persist TOTAL snapshot
  try {
    await prisma.stablecoinSnapshot.create({
      data: {
        coin: 'TOTAL',
        marketCap: intel.totalSupply,
        dominance: intel.dominance,
        change24h: intel.supplyChange24h,
        timestamp: now,
      },
    })
    count++
  } catch { /* skip */ }

  return count
}

// ─── Historical snapshots ───────────────────────────────────

export async function getStablecoinHistory(
  coin: string,
  hours = 168,
): Promise<Array<{ marketCap: number; dominance: number | null; change24h: number | null; timestamp: Date }>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)
  return prisma.stablecoinSnapshot.findMany({
    where: { coin, timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
    select: { marketCap: true, dominance: true, change24h: true, timestamp: true },
  })
}
