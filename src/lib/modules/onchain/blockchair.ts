// ─────────────────────────────────────────────────────────────
// Module: Blockchair
// sourceType: public-api
// Endpoint: api.blockchair.com
// Coverage: Multi-chain blockchain explorer — BTC, ETH, SOL, more — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.blockchair.com'

async function bcFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Blockchair ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchBlockchair(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'stats'
  const chain = (params.chain as string) ?? 'bitcoin'

  switch (action) {
    case 'stats':
      return bcFetch<unknown>(`/${chain}/stats`)
    case 'address': {
      const addr = params.address as string
      return bcFetch<unknown>(`/${chain}/dashboards/address/${addr}`)
    }
    case 'tx': {
      const hash = params.hash as string
      return bcFetch<unknown>(`/${chain}/dashboards/transaction/${hash}`)
    }
    case 'blocks':
      return bcFetch<unknown>(`/${chain}/blocks?limit=10`)
    default:
      throw new Error(`Blockchair: unknown action ${action}`)
  }
}

const blockchairModule: DataModule = {
  id: 'blockchair',
  name: 'Blockchair',
  category: 'onchain',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Blockchair — multi-chain blockchain explorer for BTC, ETH, SOL, and more',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await bcFetch('/bitcoin/stats')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('blockchair', params, TTL.ENTITY_LABEL, () => fetchBlockchair(params) as Promise<T>)
  },
}

export default blockchairModule
