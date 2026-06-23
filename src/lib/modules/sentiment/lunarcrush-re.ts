/**
 * Module: LunarCrush (social sentiment proxy)
 * sourceType: public-api
 * upstreamProduct: CoinGecko + Reddit (replaces LunarCrush)
 * endpoint: api.coingecko.com/api/v3 + reddit.com JSON API
 * discoveredVia: docs
 * lastVerified: 2026-06-23
 * No API key required. CoinGecko free tier: 10–30 req/min.
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const CG_BASE = 'https://api.coingecko.com/api/v3'
const TIMEOUT = 5_000

async function cgFetch<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${CG_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, Math.min(2000 * (attempt + 1), 5000)))
      continue
    }
    if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${path}`)
    return res.json() as Promise<T>
  }
  throw new Error(`CoinGecko ${path}: rate limited after retries`)
}

async function redditFetch(subreddit: string, limit: number): Promise<unknown[]> {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}&raw_json=1`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': '1ai-tracker:v1.0.0 (crypto sentiment)',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { data?: { children?: unknown[] } }
    return data?.data?.children ?? []
  } catch {
    return []
  }
}

const COIN_SUBREDDITS: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'ethereum', SOL: 'solana', DOGE: 'dogecoin',
  ADA: 'cardano', XRP: 'ripple', DOT: 'polkadot', AVAX: 'avaxchain',
  LINK: 'chainlink', MATIC: '0xpolygon', ATOM: 'cosmosnetwork',
  LTC: 'litecoin', XMR: 'monero', XLM: 'stellar', TRX: 'tronix',
  SHIB: 'SHIBArmy', PEPE: 'pepecoin', SUI: 'SuiNetwork',
  ARB: 'arbitrum', OP: 'optimism',
}

async function fetchSentimentData(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'trending'

  switch (action) {
    case 'trending': {
      const data = await cgFetch<{ coins: { item: Record<string, unknown> }[] }>(
        '/search/trending',
      )
      return {
        source: 'coingecko-trending',
        coins: data.coins.map((c) => c.item),
      }
    }
    case 'coin': {
      const symbol = ((params.symbol as string) ?? 'BTC').toLowerCase()
      const coin = await cgFetch<Record<string, unknown>>(
        `/coins/${symbol}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`,
      )
      return { source: 'coingecko-coin', coin }
    }
    case 'social': {
      const symbol = (params.symbol as string) ?? 'BTC'
      const subreddit = COIN_SUBREDDITS[symbol.toUpperCase()]
      if (subreddit) {
        const posts = await redditFetch(subreddit, 20)
        if (posts.length > 0) return { source: 'reddit', posts }
      }
      // Fallback to CoinGecko community data
      const coin = await cgFetch<{ community_data?: Record<string, number | null> }>(
        `/coins/${symbol.toLowerCase()}?localization=false&tickers=false&market_data=false&community_data=true&developer_data=false&sparkline=false`,
      )
      return { source: 'coingecko-community', community: coin.community_data ?? {} }
    }
    default:
      throw new Error(`LunarCrush proxy: unknown action ${action}`)
  }
}

const lunarcrushModule: DataModule = {
  id: 'lunarcrush-re',
  name: 'LunarCrush',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Social sentiment via CoinGecko trending + Reddit public API (replaces LunarCrush)',
    upstreamProduct: 'CoinGecko + Reddit',
    discoveredVia: 'docs',
    fragility: 'stable',
    lastVerified: '2026-06-23',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await cgFetch('/ping')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'CoinGecko ping failed' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'lunarcrush-re',
      params,
      TTL.SENTIMENT * TTL.RE_MULTIPLIER,
      () => fetchSentimentData(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    // No-op: primary source is already free and doesn't need a fallback
    return { data: undefined as T, source: 'none', cached: false, timestamp: Date.now(), ttl: 0 }
  },
}

export default lunarcrushModule
