// ─────────────────────────────────────────────────────────────
// Module: L2Beat
// sourceType: public-api
// Endpoint: l2beat.com/api
// Coverage: L2 TVL, risk analysis, scaling solutions — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://l2beat.com/api'

async function l2Fetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`L2Beat ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchL2Beat(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'tvls'

  switch (action) {
    case 'tvls':
      return l2Fetch<unknown>('/scaling/tvl')
    case 'summary':
      return l2Fetch<unknown>('/scaling/summary')
    default:
      throw new Error(`L2Beat: unknown action ${action}`)
  }
}

const l2beatModule: DataModule = {
  id: 'l2beat',
  name: 'L2Beat',
  category: 'defi',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'L2Beat — Layer 2 TVL tracking, risk analysis, scaling solution comparison',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await l2Fetch('/scaling/tvl')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('l2beat', params, TTL.TVL_DATA, () => fetchL2Beat(params) as Promise<T>)
  },
}

export default l2beatModule
