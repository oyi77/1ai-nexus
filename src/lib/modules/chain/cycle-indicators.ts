// ─────────────────────────────────────────────────────────────
// Module: Cycle Indicators
// sourceType: derived (computed from CoinGecko public-api data)
// Endpoint: api.coingecko.com/api/v3
// Coverage: MVRV Z-Score, NUPL, SSR, Stablecoin Dominance
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

// ── Types ─────────────────────────────────────────────────

interface CoinGeckoGlobal {
  data: {
    total_market_cap: { usd: number }
    market_cap_change_percentage_24h_usd: number
    active_cryptocurrencies: number
    markets: number
  }
}

interface CoinGeckoBitcoin {
  market_data: {
    market_cap: { usd: number }
    fully_diluted_valuation: { usd: number }
    current_price: { usd: number }
    total_supply: number
    circulating_supply: number
  }
}

interface CoinGeckoDeFi {
  data: {
    defi_market_cap: string
    eth_market_cap: string
    defi_to_eth: string
    trading_volume_24h: string
    defi_dominance: string
    top_coin_name: string
    defi_dominance_7d_percentage_change: string
    stablecoin_market_cap: string
  }
}

export interface CycleIndicator {
  name: string
  value: number
  zone: ZoneType
  description: string
  raw: {
    marketCap?: number
    realizedCapProxy?: number
    btcMarketCap?: number
    stablecoinMarketCap?: number
    stdDev?: number
  }
}

export type ZoneType =
  | 'euphoria'
  | 'bull'
  | 'neutral'
  | 'hope'
  | 'accumulation'
  | 'capitulation'

export interface CycleIndicatorsResult {
  indicators: {
    mvrv: CycleIndicator
    nupl: CycleIndicator
    ssr: CycleIndicator
    dominance: CycleIndicator
  }
  timestamp: string
  source: string
}

// ── Zone classification ──────────────────────────────────

function classifyMvrvZone(zScore: number): ZoneType {
  if (zScore > 7) return 'euphoria'
  if (zScore > 2) return 'bull'
  if (zScore >= 0) return 'neutral'
  if (zScore >= -0.5) return 'accumulation'
  return 'capitulation'
}

function classifyNuplZone(nupl: number): ZoneType {
  if (nupl > 0.75) return 'euphoria'
  if (nupl > 0.5) return 'bull'
  if (nupl > 0) return 'hope'
  return 'capitulation'
}

function classifySsrZone(ssr: number): ZoneType {
  if (ssr < 2) return 'bull'
  if (ssr < 5) return 'neutral'
  if (ssr < 10) return 'accumulation'
  return 'capitulation'
}

function classifyDominanceZone(dominance: number): ZoneType {
  if (dominance > 15) return 'capitulation'
  if (dominance > 10) return 'accumulation'
  if (dominance > 5) return 'neutral'
  return 'bull'
}

// ── Fetch CoinGecko data ──────────────────────────────────

async function coingeckoFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Nexus/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

// ── Core computation ──────────────────────────────────────

async function computeCycleIndicators(): Promise<CycleIndicatorsResult> {
  const [globalData, btcData, defiData] = await Promise.all([
    coingeckoFetch<CoinGeckoGlobal>(`${COINGECKO_BASE}/global`),
    coingeckoFetch<CoinGeckoBitcoin>(`${COINGECKO_BASE}/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false`),
    coingeckoFetch<CoinGeckoDeFi>(`${COINGECKO_BASE}/global/decentralized_finance_defi`),
  ])

  const totalMarketCap = globalData.data.total_market_cap.usd
  const btcMarketCap = btcData.market_data.market_cap.usd
  const fdv = btcData.market_data.fully_diluted_valuation.usd
  const stablecoinMarketCap = parseFloat(defiData.data.stablecoin_market_cap) || 0

  // Realized Cap Proxy = FDV as simplification
  const realizedCapProxy = fdv

  // MVRV Z-Score: (Market Cap - Realized Cap) / StdDev
  // StdDev proxy: use 20% of market cap as historical volatility proxy
  const stdDev = totalMarketCap * 0.2
  const mvrvZScore = stdDev > 0 ? (totalMarketCap - realizedCapProxy) / stdDev : 0

  // NUPL: 1 - (Realized Cap / Market Cap)
  const nupl = totalMarketCap > 0 ? 1 - (realizedCapProxy / totalMarketCap) : 0

  // SSR: BTC Market Cap / Total Stablecoin Market Cap
  const ssr = stablecoinMarketCap > 0 ? btcMarketCap / stablecoinMarketCap : 0

  // Stablecoin Dominance: Stablecoin mcap / Total crypto mcap
  const dominance = totalMarketCap > 0 ? (stablecoinMarketCap / totalMarketCap) * 100 : 0

  return {
    indicators: {
      mvrv: {
        name: 'MVRV Z-Score',
        value: Math.round(mvrvZScore * 100) / 100,
        zone: classifyMvrvZone(mvrvZScore),
        description: 'Market Value to Realized Value Z-Score. Measures deviation of market cap from realized cap. >7 = extreme overvaluation.',
        raw: { marketCap: totalMarketCap, realizedCapProxy, stdDev },
      },
      nupl: {
        name: 'NUPL',
        value: Math.round(nupl * 1000) / 1000,
        zone: classifyNuplZone(nupl),
        description: 'Net Unrealized Profit/Loss. Ratio of unrealized profit to market cap. >0.75 = euphoria zone.',
        raw: { marketCap: totalMarketCap, realizedCapProxy },
      },
      ssr: {
        name: 'SSR',
        value: Math.round(ssr * 100) / 100,
        zone: classifySsrZone(ssr),
        description: 'Stablecoin Supply Ratio. BTC market cap / stablecoin market cap. Low SSR = high buying pressure ready.',
        raw: { btcMarketCap, stablecoinMarketCap },
      },
      dominance: {
        name: 'Stablecoin Dominance',
        value: Math.round(dominance * 100) / 100,
        zone: classifyDominanceZone(dominance),
        description: 'Stablecoin market cap as % of total crypto market cap. Rising = risk-off sentiment.',
        raw: { stablecoinMarketCap, marketCap: totalMarketCap },
      },
    },
    timestamp: new Date().toISOString(),
    source: 'CoinGecko (public-api)',
  }
}

// ── Module definition ─────────────────────────────────────

const cycleIndicatorsModule: DataModule = {
  id: 'cycle-indicators',
  name: 'Cycle Indicators',
  category: 'onchain',
  sourceType: 'derived',
  provenance: {
    describesItself: 'Crypto cycle indicators (MVRV, NUPL, SSR) computed from CoinGecko global market data',
    fragility: 'moderate',
    lastVerified: '2026-07-01',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await coingeckoFetch<{ data: Record<string, unknown> }>(`${COINGECKO_BASE}/global`)
      return {
        status: 'active',
        lastChecked: new Date(),
        lastSuccess: new Date(),
        failureCount: 0,
        notes: 'CoinGecko /global reachable',
      }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    const action = (params.action as string) ?? 'current'

    return cachedFetch<T>(
      'cycle-indicators',
      params,
      TTL.TVL_DATA, // 5 min — cycle indicators don't need sub-minute refresh
      async () => {
        if (action === 'current') {
          return computeCycleIndicators() as T
        }
        throw new Error(`cycle-indicators: unknown action ${action}`)
      },
    )
  },
}

export default cycleIndicatorsModule
