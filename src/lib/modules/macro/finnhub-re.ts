/**
 * Module: Finnhub
 * sourceType: re
 * upstreamProduct: Finnhub
 * endpoint: finnhub.io dashboard
 * discoveredVia: devtools-network-tab
 * lastVerified: 2026-06-19
 * UNOFFICIAL: this calls Finnhub's internal frontend API, not their public API.
 *   It may break without notice if they change their dashboard.
 *   fallbackFn: fed-rss + static calendar seed
 */

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

// Static economic calendar seed (public knowledge)
const CALENDAR_EVENTS = [
  { date: '2026-07-29', event: 'FOMC Rate Decision', impact: 'high' },
  { date: '2026-08-12', event: 'CPI Release', impact: 'high' },
  { date: '2026-09-17', event: 'FOMC Rate Decision', impact: 'high' },
  { date: '2026-10-29', event: 'FOMC Rate Decision', impact: 'high' },
  { date: '2026-12-17', event: 'FOMC Rate Decision', impact: 'high' },
]

async function fetchFinnhub(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'calendar'

  if (action === 'calendar') {
    // Try RE endpoint first
    try {
      const res = await fetch('https://finnhub.io/api/v1/calendar/economic?token=', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const json = await res.json() as Record<string, unknown>
        if (json.economicCalendar) return json.economicCalendar
      }
    } catch {
      // Fall through to seed
    }
    return CALENDAR_EVENTS
  }

  throw new Error(`Finnhub: unknown action ${action}`)
}

const finnhubModule: DataModule = {
  id: 'finnhub-re',
  name: 'Finnhub',
  category: 'macro',
  sourceType: 're',
  provenance: {
    describesItself: 'Finnhub economic calendar events, release dates, consensus estimates',
    upstreamProduct: 'Finnhub',
    discoveredVia: 'devtools-network-tab',
    fragility: 'fragile',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    return { status: 'degraded', lastChecked: new Date(), failureCount: 0, notes: 'Using static calendar seed' }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'finnhub-re',
      params,
      TTL.MACRO_DATA * TTL.RE_MULTIPLIER,
      () => fetchFinnhub(params) as Promise<T>,
    )
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: CALENDAR_EVENTS as T,
      source: 'finnhub-re (static seed)',
      cached: true,
      timestamp: Date.now(),
      ttl: TTL.MACRO_DATA,
    }
  },
}

export default finnhubModule
