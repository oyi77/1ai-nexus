// ─────────────────────────────────────────────────────────────
// Module: DBnomics
// sourceType: public-api
// Endpoint: api.db.nomics.world
// Coverage: Aggregates IMF + World Bank + FRED + BIS + OECD — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.db.nomics.world/v22'

async function dbnFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`DBnomics ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchDBnomics(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'search'

  switch (action) {
    case 'search': {
      const q = (params.q as string) ?? 'GDP'
      return dbnFetch<unknown>(`/search/datasets?q=${encodeURIComponent(q)}&limit=20`)
    }
    case 'series': {
      const provider = (params.provider as string) ?? 'FRED'
      const dataset = (params.dataset as string) ?? 'GDP'
      const series = (params.series as string) ?? 'GDP'
      return dbnFetch<unknown>(`/series/${provider}/${dataset}/${series}?limit=20`)
    }
    case 'providers':
      return dbnFetch<unknown>('/providers?limit=50')
    default:
      throw new Error(`DBnomics: unknown action ${action}`)
  }
}

const dbnomicsModule: DataModule = {
  id: 'dbnomics',
  name: 'DBnomics',
  category: 'macro',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'DBnomics — aggregates IMF, World Bank, FRED, BIS, OECD economic data in one API',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await dbnFetch('/providers?limit=1')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('dbnomics', params, TTL.MACRO_DATA, () => fetchDBnomics(params) as Promise<T>)
  },
}

export default dbnomicsModule
