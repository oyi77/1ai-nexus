// ─────────────────────────────────────────────────────────────
// Module: GDELT Project
// sourceType: public-api
// Endpoint: api.gdeltproject.org/api/v2
// Coverage: Global event database — news from every country, 100+ languages, sentiment
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.gdeltproject.org/api/v2'

async function gdeltFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GDELT ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchGDELT(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'geo'

  switch (action) {
    case 'geo': {
      const mode = (params.mode as string) ?? 'pointdata'
      return gdeltFetch<unknown>(`/geo?query=${encodeURIComponent(params.query as string ?? 'crypto')}&mode=${mode}&format=geojson`)
    }
    case 'doc': {
      const query = (params.query as string) ?? 'cryptocurrency'
      return gdeltFetch<unknown>(`/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=20&format=json`)
    }
    case 'summary': {
      const query = (params.query as string) ?? 'bitcoin'
      return gdeltFetch<unknown>(`/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=10&format=json`)
    }
    default:
      throw new Error(`GDELT: unknown action ${action}`)
  }
}

const gdeltModule: DataModule = {
  id: 'gdelt',
  name: 'GDELT Project',
  category: 'news',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'GDELT — global event database monitoring news from every country in 100+ languages with sentiment',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await gdeltFetch('/doc/doc?query=bitcoin&mode=artlist&maxrecords=1&format=json')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('gdelt', params, TTL.NEWS, () => fetchGDELT(params) as Promise<T>)
  },
}

export default gdeltModule
