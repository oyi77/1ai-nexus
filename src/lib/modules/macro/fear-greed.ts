// ─────────────────────────────────────────────────────────────
// Module: Fear & Greed Index
// sourceType: public-api
// Endpoint: api.alternative.me/fng
// Coverage: Crypto Fear & Greed Index, 30-day historical
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.alternative.me/fng'

async function fetchFearGreed(params: FetchParams): Promise<unknown> {
  const limit = (params.limit as number) ?? 30
  const res = await fetch(`${BASE}/?limit=${limit}&format=json`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Fear&Greed ${res.status}`)
  const json = await res.json() as { data: Array<{ value: string; value_classification: string; timestamp: string }> }
  return json.data.map(d => ({
    value: Number(d.value),
    classification: d.value_classification,
    timestamp: Number(d.timestamp),
  }))
}

const fearGreedModule: DataModule = {
  id: 'fear-greed',
  name: 'Fear & Greed Index',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Alternative.me Crypto Fear & Greed Index — daily score 0-100 with 30-day history',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      const res = await fetch(`${BASE}/?limit=1&format=json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'fear-greed',
      params,
      TTL.SENTIMENT,
      () => fetchFearGreed(params) as Promise<T>,
    )
  },
}

export default fearGreedModule
