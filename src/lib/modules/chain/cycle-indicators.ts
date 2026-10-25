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

interface CoinGeckoStablecoinMarket {
  market_cap: number | null
}

export interface CycleIndicator {
  name: string
  value: number | null
  zone: ZoneType | 'unavailable'
  description: string
  raw: {
    marketCap?: number
    btcMarketCap?: number
    stablecoinMarketCap?: number
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
  const [globalData, btcData, stablecoins] = await Promise.all([
    coingeckoFetch<CoinGeckoGlobal>(`${COINGECKO_BASE}/global`),
    coingeckoFetch<CoinGeckoBitcoin>(`${COINGECKO_BASE}/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false`),
    coingeckoFetch<CoinGeckoStablecoinMarket[]>(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=250&page=1&sparkline=false`),
  ])

  const totalMarketCap = globalData.data.total_market_cap.usd
  const btcMarketCap = btcData.market_data.market_cap.usd
  const stablecoinMarketCap = stablecoins.reduce((sum, coin) => sum + (coin.market_cap ?? 0), 0)
  const ssr = stablecoinMarketCap > 0 ? btcMarketCap / stablecoinMarketCap : null
  const dominance = stablecoinMarketCap > 0 && totalMarketCap > 0 ? (stablecoinMarketCap / totalMarketCap) * 100 : null

  return {
    indicators: {
      mvrv: {
        name: 'MVRV Z-Score',
        value: null,
        zone: 'unavailable',
        description: 'Unavailable: CoinGecko does not provide the realized-cap and historical realized-cap volatility required for MVRV Z-Score.',
        raw: { marketCap: btcMarketCap },
      },
      nupl: {
        name: 'NUPL',
        value: null,
        zone: 'unavailable',
        description: 'Unavailable: holder-level realized cap is required to calculate Net Unrealized Profit/Loss.',
        raw: { marketCap: btcMarketCap },
      },
      ssr: {
        name: 'SSR',
        value: ssr == null ? null : Math.round(ssr * 100) / 100,
        zone: ssr == null ? 'unavailable' : classifySsrZone(ssr),
        description: stablecoinMarketCap > 0 ? 'Stablecoin Supply Ratio. BTC market cap / stablecoin market cap. Low SSR = high buying pressure ready.' : 'Unavailable: stablecoin market cap could not be verified.',
        raw: { btcMarketCap, ...(stablecoinMarketCap > 0 ? { stablecoinMarketCap } : {}) },
      },
      dominance: {
        name: 'Stablecoin Dominance',
        value: dominance == null ? null : Math.round(dominance * 100) / 100,
        zone: dominance == null ? 'unavailable' : classifyDominanceZone(dominance),
        description: dominance == null ? 'Unavailable: stablecoin market cap could not be verified.' : 'Stablecoin market cap as % of total crypto market cap. Rising = risk-off sentiment.',
        raw: { marketCap: totalMarketCap, ...(stablecoinMarketCap > 0 ? { stablecoinMarketCap } : {}) },
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
