// ─────────────────────────────────────────────────────────────
// Module: DeFiLlama
// sourceType: public-api
// Endpoint: api.llama.fi, yields.llama.fi, coins.llama.fi
// Coverage: Protocol TVL (3,000+), yields, stablecoins, bridges, fees
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.llama.fi'
const YIELDS_BASE = 'https://yields.llama.fi'
const COINS_BASE = 'https://coins.llama.fi'
const STABLECOINS_BASE = 'https://stablecoins.llama.fi'

async function llamaFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`DeFiLlama ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

async function fetchDeFiLlama(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'protocols'

  switch (action) {
    case 'protocols':
      return llamaFetch<unknown[]>(`${BASE}/protocols`)
    case 'protocol': {
      const slug = params.slug as string
      return llamaFetch<unknown>(`${BASE}/protocol/${slug}`)
    }
    case 'chains':
      return llamaFetch<unknown>(`${BASE}/v2/chains`)
    case 'yields':
      return llamaFetch<{ data: unknown[] }>(`${YIELDS_BASE}/pools`).then(r => r.data)
    case 'stablecoins':
      return llamaFetch<unknown[]>(`${STABLECOINS_BASE}/stablecoins?includePrices=true`)
    case 'prices': {
      const coins = (params.coins as string) ?? ''
      return llamaFetch<unknown>(`${COINS_BASE}/prices/current/${coins}`)
    }
    case 'dex-volumes':
      return llamaFetch<unknown>(`${BASE}/overview/dex`)
    case 'fees':
      return llamaFetch<unknown>(`${BASE}/overview/fees`)
    default:
      throw new Error(`DeFiLlama: unknown action ${action}`)
  }
}

const defillamaModule: DataModule = {
  id: 'defillama',
  name: 'DeFiLlama',
  category: 'defi',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'DeFiLlama — TVL, yields, stablecoins, bridges, fees for 3,000+ protocols',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const data = await llamaFetch<unknown[]>('https://api.llama.fi/protocols')
      return {
        status: 'active',
        lastChecked: new Date(),
        lastSuccess: new Date(),
        failureCount: 0,
        notes: `${data.length} protocols`,
      }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'defillama',
      params,
      params.action === 'prices' ? TTL.PRICE_DATA : TTL.TVL_DATA,
      () => fetchDeFiLlama(params) as Promise<T>,
    )
  },
}

export default defillamaModule
