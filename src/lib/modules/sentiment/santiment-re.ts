/**
 * Module: Santiment
 * sourceType: re
 * upstreamProduct: Santiment
 * endpoint: santiment.net public chart endpoints
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Santiment's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: github-public (commit activity)
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.santiment.net'

async function santimentFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Santiment ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchSantiment(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'dev-activity'

  switch (action) {
    case 'dev-activity': {
      const slug = (params.slug as string) ?? 'bitcoin'
      return santimentFetch<unknown>(`/projects/${slug}/dev-activity`)
    }
    case 'social': {
      const slug = (params.slug as string) ?? 'bitcoin'
      return santimentFetch<unknown>(`/projects/${slug}/social-dominance`)
    }
    default:
      throw new Error(`Santiment: unknown action ${action}`)
  }
}

const santimentModule: DataModule = {
  id: 'santiment-re',
  name: 'Santiment',
  category: 'sentiment',
  sourceType: 're',
  provenance: {
    describesItself: 'Santiment dev activity score, social dominance per project',
    upstreamProduct: 'Santiment',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await santimentFetch('/projects/bitcoin/dev-activity')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch {
      return { status: 'degraded', lastChecked: new Date(), failureCount: 1, notes: 'Using GitHub public fallback' }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'santiment-re',
      params,
      TTL.SENTIMENT * TTL.RE_MULTIPLIER,
      () => fetchSantiment(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    // Fallback: GitHub public API commit activity
    try {
      const res = await fetch('https://api.github.com/repos/bitcoin/bitcoin/stats/commit_activity', {
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json() as Array<{ total: number; week: number }>
      return { data: data as T, source: 'santiment-re (github fallback)', cached: true, timestamp: Date.now(), ttl: TTL.SENTIMENT }
    } catch {
      return { data: [] as T, source: 'santiment-re (unavailable)', cached: true, timestamp: Date.now(), ttl: TTL.SENTIMENT }
    }
  },
}

export default santimentModule
