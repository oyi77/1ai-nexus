// ─────────────────────────────────────────────────────────────
// Module: Manifold Markets
// sourceType: public-api
// Endpoint: manifold.markets/api/v0
// Coverage: Community prediction markets, all categories
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://manifold.markets/api/v0'

async function fetchManifold(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'markets'

  switch (action) {
    case 'markets': {
      const limit = (params.limit as number) ?? 50
      const sort = (params.sort as string) ?? 'liquidity'
      const url = `${BASE}/markets?limit=${limit}&sort=${sort}`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`Manifold ${res.status}`)
      return res.json()
    }
    case 'market': {
      const id = params.id as string
      const res = await fetch(`${BASE}/market/${id}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`Manifold ${res.status}`)
      return res.json()
    }
    default:
      throw new Error(`Manifold: unknown action ${action}`)
  }
}

const manifoldModule: DataModule = {
  id: 'manifold',
  name: 'Manifold Markets',
  category: 'prediction',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Manifold Markets — community prediction markets with real money play-money hybrid',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const res = await fetch(`${BASE}/markets?limit=1`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'manifold',
      params,
      TTL.PREDICTION,
      () => fetchManifold(params) as Promise<T>,
    )
  },
}

export default manifoldModule
